import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { Authenticator } from "./authenticator";
import { HTTPHeaders, HTTPMethod, URLParams } from "../http";
import * as qs from 'qs';
import { logger } from "../../service/logger";
import { StreamV2 } from "./stream";
import { InputTapState } from "../state";
import { ITarget } from "../target/target";
import { getAxiosInstance } from "../../service/network";
import { DEFAULT_MAX_CONCURRENT_STREAMS } from "./tap";
import { API_CALLS_METRIC_NAME, CounterMetric, getCounterMetrics, MetricConfiguration } from "../../service/metric";
import { getTruncatedParamsForLog } from "../../helpers/qs-logger";
import * as _ from "lodash";

/**
 * R: Type of the API result
 * NPT: Type of the "nextPageToken"
 */
export abstract class RESTStreamV2<R, O, NPT, C, P = undefined>
    extends StreamV2<O, C, P> {

    axiosInstance: AxiosInstance | undefined;

    constructor(
        tapName: string,
        config: C,
        state: InputTapState,
        target: ITarget,
        childConcurrency: number = DEFAULT_MAX_CONCURRENT_STREAMS
    ) {
        super(tapName, config, state, target, childConcurrency);
        this.apiCallsMetricsConf = {
            isEnabled: () => !this.isSilent,
            getStreamIds: () => [this.streamId]
        }
    }

    // Internal
    // Those functions shouldn't be overriden (or it means that we fuck'ed up the SDK during the design phase)

    /**
     * Prepare an Axios request object.
     * Pagination information can be parsed from `nextPageToken` if `nextPageToken` is not undefined.
     * @param nextPageToken 
     * @returns 
     */
    _prepareRequest = async (nextPageToken: NPT | undefined, parent?: P)
        : Promise<AxiosRequestConfig> => {

        const method = this.httpMethod;
        const url = this.getUrl(parent);
        if (!url) {
            throw new Error(`StreamId: ${this.streamId} - URL is undefined. Did your properly define the URL for this stream?`)
        }

        const authenticator = this.authenticator

        const params = {
            ...this.getNextUrlParams(nextPageToken, parent),
            ...(await authenticator?.getAuthQS(this._config))
        }

        const requestBody = this.getRequestBodyForNextCall(nextPageToken, parent)
        let headers = this.getCustomHTTPHeaders(parent);
        if (!headers) {
            headers = {};
        }

        if (authenticator) {
            const authHeaders = await authenticator.getAuthHeaders(this._config)
            headers = {
                ...headers,
                ...authHeaders
            }
        }

        const paramsSerializer = (params: any) => {
            return qs.stringify(params, { arrayFormat: 'repeat' })
        }

        const request: AxiosRequestConfig = {
            url,
            method,
            data: requestBody,
            params,
            paramsSerializer,
            headers
        }
        return request
    }

    async _requestWithRetry(request: AxiosRequestConfig, privateLogging?: boolean): Promise<R | "STOP_SYNC"> {
        try {
            logger.debug(`🤖 ${request.method} ${request.url} with params: %j | body: %j`,
                request.params,
                request.data,
                { private: privateLogging });
            logger.info(`🤖 ${request.method} ${request.url} qs: %j`,
                getTruncatedParamsForLog(request.params),
                { private: privateLogging });
            const axiosInstance = this.axiosInstance;
            if (!axiosInstance) {
                throw new Error(`Axios Instance is not initialized!`)
            }
            const response = await axiosInstance.request<R>(request);
            return response.data;
        } catch (err) {
            if (axios.isAxiosError(err)) {
                logger.error(`🤖 Error on ${request.method} ${request.url} with params %j | body: %j | headers: %j - getting error %s - response body: %j`,
                    request.params,
                    request.data,
                    request.headers,
                    err.message,
                    err.response?.data
                )
                const recoveredValue = await this.httpErrorHandler(request.url, err);
                if (recoveredValue === undefined) {
                    return "STOP_SYNC"
                } else {
                    return recoveredValue;
                }
            } else {
                throw err;
            }
        }
    }

    async *_requestRecords(parent?: P): AsyncIterable<O> {
        let nextPageToken: NPT | undefined = undefined;
        let finished = false;

        let apiCallsMetrics: CounterMetric[] = [];
        if (this.apiCallsMetricsConf.isEnabled() === true) {
            apiCallsMetrics = getCounterMetrics(
                API_CALLS_METRIC_NAME,
                this.apiCallsMetricsConf.getStreamIds
                    ? this.apiCallsMetricsConf.getStreamIds()
                    : []
            )
        }

        // We reset the axios instance here to use the value of `httpRetryCount` after the initialization of custom values defined in the Streams impl.
        // Doing it in the constructor is givingf us access only to the default value of `httpRetryCount`
        this.axiosInstance = getAxiosInstance(this.httpRetryCount);

        while (!finished) {
            const preparedRequest = await this._prepareRequest(nextPageToken, parent);
            const resp = await this._requestWithRetry(preparedRequest);

            apiCallsMetrics.forEach(metric => {
                metric.increment();
            })

            // We stop the sync for this stream
            if (resp === "STOP_SYNC") {
                return;
            }
            const rows = this.parseResponse(resp, parent, nextPageToken);
            for await (const row of rows) {
                yield row
            }

            const previousToken = _.cloneDeep(nextPageToken);
            nextPageToken = this.getNextPageToken(resp, previousToken);

            if (nextPageToken && _.isEqual(nextPageToken, previousToken)) {
                throw new Error(
                    `${this.streamId} - Loop detected in pagination. "
                    Pagination token: \`${JSON.stringify(nextPageToken)}\` is identical to prior token \`${JSON.stringify(previousToken)}\`.`
                )
            }
            // Cycle until getNextPageToken() no longer returns a value
            finished = !nextPageToken
        }
    }

    async *_getRecords(parent?: P): AsyncIterable<O> {
        for await (const row of this._requestRecords(parent)) {
            yield row
        }
    }

    // Overridable
    // Even if the default impl. of some function can be used as-is, those functions
    // are meant to be overriden when necessary to match the API needs.
    httpMethod: HTTPMethod = "GET";
    baseUrl: string = "";
    path: string = "";
    httpRetryCount = 24;
    authenticator?: Authenticator<C>;

    apiCallsMetricsConf: MetricConfiguration

    // When undefined is returned, we should stop the sync without any error
    async httpErrorHandler(url: string | undefined, err: AxiosError): Promise<R | undefined> {
        if ((err.response?.status || 0) > 400) {
            throw new Error(`We got a \`${err.response?.status}\` status code from endpoint: \`${url}\`. 

            Response body from the server: ${JSON.stringify(err.response?.data)}`);
        }
        throw err;
    }

    /** 
     * Return a dictionary of values to be used in URL parameterization.
     * If paging is supported, developers may override with specific paging logic.
     * 
     * By default, no params are passed.
    */
    getNextUrlParams(nextPageToken: NPT | undefined, parent?: P): URLParams {
        return {}
    }

    /** 
     * Prepare the data payload for the REST API request.
     * Useful when working with POST APIs.
     * 
     * By default, no payload will be sent (return undefined).
    */
    getRequestBodyForNextCall(nextPageToken: NPT | undefined, parent?: P): any {
        return undefined
    }

    /**
     * Return token identifying next page or undefined if all records have been read.
     * 
     * By default, no token will be returned and a single API call will be made.
     * 
     * @param response 
     * @param previousToken 
     * @returns 
     */
    getNextPageToken(response: R, previousToken?: NPT): NPT | undefined {
        return undefined;
    }

    /**
     * Return custom headers to be used for HTTP requests.
     * 
     * By default, no additional header will be added
     */
    getCustomHTTPHeaders(parent?: P): HTTPHeaders | undefined {
        return undefined;
    }

    /**
     * Return a URL, optionally targeted to a specific partition.
     * This can be overriden to perform dynamic URL generation.
     * 
     * TODO: Make URL + Path templatisable and replace those with Extractor (or Tap) config
     * @returns 
     */
    getUrl(parent?: P): string {
        const urlPattern = [this.baseUrl, this.path].join("")
        return urlPattern;
    }

    /**
     * Parse the response and return an iterator of result rows.
     * 
     * Default impl assume that R = O or R = O[]
     * @param response
     */
    async *parseResponse(
        response: R,
        parent?: P,
        nextPageToken?: NPT
    ): AsyncIterable<O> {
        if (Array.isArray(response)) {
            for (const row of response) {
                yield row as any as O
            }
        } else {
            yield response as any as O
        }
    }

}