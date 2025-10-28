import axios, { AxiosError, AxiosInstance, AxiosResponse, AxiosRequestConfig, AxiosRequestHeaders } from "axios";
import { URLSearchParams } from "url";
import * as fs from 'fs';
import * as qs from 'qs';
import axiosRetry, { isNetworkOrIdempotentRequestError } from 'axios-retry';
import { logger } from "./logger";

// This retry regardless of whether the call is idempotent or not. 
// e.g. this will retry POST and PUT.
// Hence, this service and all its function SHOULD not be used to create things as it is not safe. 
// This service should be only used for extracting data.
const shouldRetry = (error: AxiosError): boolean => {

    const statusCode = error.response ? error.response.status : 0;

    return error.code !== 'ECONNABORTED' // Triggered if there is not enough local socket. In those case, retrying will only make things worse
        && (
            !error.response
            || statusCode === 429
            || statusCode === 409
            || statusCode === 400
            || (statusCode >= 500 && statusCode < 599)
        );
}

export const getAxiosInstance = (retryCount?: number): AxiosInstance => {
    const instance = axios.create({
        timeout: 120_000
    });
    axiosRetry(instance,
        {
            retries: retryCount || 24,
            retryDelay: (retryCount, error) => {
                logger.info(`🔁 Retrying for the ${retryCount}th time the call for 
                    method=${error.config?.method}
                    url=${error.config?.url}
                    params=%j
                    body=%j`,
                    error.config?.params,
                    error.config?.data
                )
                if (retryCount > 6) {
                    return 10000
                }
                return axiosRetry.exponentialDelay(retryCount)
            },
            retryCondition: (error: AxiosError): boolean => {
                logger.debug(`😱 Got an error for ${error.config?.method} ${error.config?.url}
                
                Status: ${error?.response?.status}
                Error code ${error.code}
                Error config method ${error}`)

                return isNetworkOrIdempotentRequestError(error)
                    || shouldRetry(error)
            }
        });
    return instance;
}

export interface GetConfig {
    qs?: { [key: string]: any },
    headers?: AxiosRequestHeaders,
    retryCount?: number
}

export const getRawJSONApiCall = async <T>(
    endpoint: string,
    config: GetConfig,
    privateLogging?: boolean
): Promise<AxiosResponse<T>> => {

    const instance = getAxiosInstance(config.retryCount);

    // Repeat the key/value pair multiple time when having arrays to be passed in the QS
    const paramsSerializer = (params: any) => {
        return qs.stringify(params, { arrayFormat: 'repeat' })
    }

    try {
        logger.info(`🤖 GET ${endpoint}`, { private: privateLogging })
        const requestConfig: AxiosRequestConfig = {
            params: config.qs,
            paramsSerializer: { serialize: (params) => qs.stringify(params, { arrayFormat: 'repeat' }) }
        };
        if (config.headers) {
            requestConfig.headers = config.headers;
        }
        const response = await instance.get(
            endpoint,
            requestConfig
        );
        return response;
    } catch (err: any) {
        if (err.response.status > 400) {
            throw new Error(`We got a \`${err.response.status}\` status code from endpoint: \`${endpoint}\`. 

            headers response: ${JSON.stringify(err.response.headers)}

            Response body from the server: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

export const getJSONApiCallWithFullResponse = async <T>(
    endpoint: string,
    config: GetConfig,
    privateLogging?: boolean
) => {
    const instance = getAxiosInstance(config.retryCount);

    // Repeat the key/value pair multiple time when having arrays to be passed in the QS
    const paramsSerializer = (params: any) => {
        return qs.stringify(params, { arrayFormat: 'repeat' })
    }

    try {
        logger.info(`🤖 GET ${endpoint} with params: %s`, config.qs, { private: privateLogging })
        const requestConfig: AxiosRequestConfig = {
            params: config.qs,
            paramsSerializer: { serialize: (params) => qs.stringify(params, { arrayFormat: 'repeat' }) }
        };
        if (config.headers) {
            requestConfig.headers = config.headers;
        }
        const response = await instance.get(endpoint, requestConfig);
        return response;
    } catch (err) {
        if (err instanceof Error) {
            if (axios.isAxiosError(err)) {
                if ((err.response?.status || 0) > 400) {
                    logger.warn(`We got a \`${err.response?.status}\` status code from endpoint: \`${endpoint}\`. 

            Headers response: ${JSON.stringify(err.response?.headers)}

            Response body from the server: ${JSON.stringify(err.response?.data)}`);
                }
            }
        }
        throw err;
    }
}

export const getJSONApiCall = async <T>(
    endpoint: string,
    config: GetConfig,
    privateLogging?: boolean
): Promise<T> => {
    const fullResponse = await getJSONApiCallWithFullResponse(
        endpoint,
        config,
        privateLogging
    );
    return fullResponse.data;
}

export const getDownloadFileApiCall = async <T>(
    endpoint: string,
    config: GetConfig,
    output: string,
    privateLogging?: boolean
): Promise<{ outputDir: string }> => {

    const instance = getAxiosInstance(config.retryCount);

    const writer = fs.createWriteStream(output)

    const paramsSerializer = (params: any) => {
        return qs.stringify(params, { arrayFormat: 'repeat' })
    }

    logger.info(`🤖 GET ${endpoint}`, { private: privateLogging })

    return instance({
        method: "GET",
        url: endpoint,
        responseType: 'stream',
        params: config.qs,
        ...(config.headers ? { headers: config.headers } : {}),
        paramsSerializer: { serialize: (params) => qs.stringify(params, { arrayFormat: 'repeat' }) }
    }).then(response => {
        return new Promise<{ outputDir: string }>((resolve, reject) => {
            response.data.pipe(writer);
            let error: any = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) {
                    resolve({ outputDir: output });
                }
                //no need to call the reject here, as it will have been called in the
                //'error' stream;
            });
        });
    });
}

export interface PostConfig {
    qs?: { [key: string]: any },
    headers?: AxiosRequestHeaders,
    retryCount?: number
}

export const postJSONApiCall = async <T>(
    endpoint: string,
    config: PostConfig,
    payload: any
): Promise<T> => {

    const instance = getAxiosInstance(config.retryCount);
    try {
        const requestConfig: AxiosRequestConfig = { params: config.qs };
        if (config.headers) {
            requestConfig.headers = config.headers;
        }
        const response = await instance.post(
            endpoint,
            payload,
            requestConfig
        );
        return response.data;
    } catch (err: any) {
        if (err?.response?.status >= 400) {
            throw new Error(`We got a \`${err.response.status}\` status code from endpoint: \`${endpoint}\`. 
            
            Response body from the server: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

export const postFormDataApiCall = async <T>(endpoint: string, config: PostConfig, payload: any): Promise<T> => {

    const instance = getAxiosInstance(config.retryCount);

    try {
        const response = await instance({
            method: 'post',
            url: endpoint,
            headers: {
                ...(payload as any).getHeaders()
            },
            data: payload
        });
        return response.data;
    } catch (err: any) {
        if (err.response.status > 400) {
            throw new Error(`We got a \`${err.response.status}\` status code from endpoint: \`${endpoint}\`. 
            
            Response body from the server: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

export const postUrlEncodedApiCall = async (endpoint: string, config: PostConfig, payload: any) => {

    const instance = getAxiosInstance(config.retryCount);

    try {

        const params = new URLSearchParams(payload as any);

        const response = await instance.post(
            endpoint,
            params.toString(),
            {
                ...(config.headers ? { headers: config.headers } : {})
            });
        return response.data;
    } catch (err: any) {
        if (err.response.status > 400) {
            throw new Error(`We got a \`${err.response.status}\` status code from endpoint: \`${endpoint}\`. 
            
            Response body from the server: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}