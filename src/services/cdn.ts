import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { logger } from "../sdk/service/logger";
import { getApiEndpoint } from "../sdk/service/apiEndpoint";
import { getServiceAccountKey } from "../sdk/service/serviceAccountKey";

const logPrefix = "[CdnService]";
const MAX_RETRIES = 10;

export interface CdnServiceConfig {
    /** e.g. "https://org.my.whaly.io" */
    apiEndpoint?: string;
    /** e.g. "sk:xxxx" */
    serviceAccountKey?: string;
}

export interface CdnUploadResult {
    /** "/org/{cdnId}/file/{fileName}" */
    filePath: string;
}

export interface CdnFileMetadata {
    exists: boolean;
    /** GCS `updated` timestamp, null if file doesn't exist or header absent. */
    lastModified: Date | null;
    contentType: string | null;
}

export class CdnService {
    private axiosClient: AxiosInstance;

    constructor(config: CdnServiceConfig) {
        const resolvedKey = getServiceAccountKey(config.serviceAccountKey);
        const resolvedEndpoint = getApiEndpoint(config.apiEndpoint);
        this.axiosClient = axios.create({
            baseURL: resolvedEndpoint,
            timeout: 120_000,
            headers: {
                Authorization: `Bearer ${resolvedKey}`,
                Accept: "application/json",
            },
        });

        axiosRetry(this.axiosClient, {
            retries: MAX_RETRIES,
            retryCondition: (error: AxiosError): boolean => {
                const status = error.response?.status ?? 0;
                return !error.response || status === 429 || (status >= 500 && status < 600);
            },
            retryDelay: (retryCount: number, error: AxiosError): number => {
                const retryAfter = error.response?.headers?.["retry-after"];
                if (retryAfter) {
                    const seconds = Number(retryAfter);
                    if (!isNaN(seconds) && seconds > 0) {
                        logger.info(`${logPrefix} Rate limited — waiting ${seconds}s (Retry-After header), attempt ${retryCount}/${MAX_RETRIES}`);
                        return seconds * 1000;
                    }
                }
                // Fallback to exponential backoff if no Retry-After header
                const delay = axiosRetry.exponentialDelay(retryCount);
                logger.info(`${logPrefix} Retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES}) for ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
                return delay;
            },
        });
    }

    /**
     * Returns metadata for a CDN file via a HEAD request.
     * If the file does not exist, returns `{ exists: false, lastModified: null, contentType: null }`.
     * Falls back to not-existing if HEAD is not supported (405).
     */
    async getFileMetadata(cdnId: string, fileName: string): Promise<CdnFileMetadata> {
        const url = `/v1/cdn/${cdnId}/files/${encodeURIComponent(fileName)}`;
        try {
            const response = await this.axiosClient.head(url);
            const lastModifiedHeader = response.headers['last-modified'];
            const contentTypeHeader = response.headers['content-type'];
            return {
                exists: true,
                lastModified: lastModifiedHeader ? new Date(lastModifiedHeader) : null,
                contentType: contentTypeHeader ?? null,
            };
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                if (status === 404) return { exists: false, lastModified: null, contentType: null };
                if (status === 405) {
                    logger.warn(`${logPrefix} HEAD not supported for ${url}, treating file as absent`);
                    return { exists: false, lastModified: null, contentType: null };
                }
                this.throwMeaningfulError(err);
            }
            throw err;
        }
    }

    /**
     * Checks whether a file already exists in the CDN via a HEAD request.
     * Returns true if the server responds 2xx, false on 404.
     * Falls back to false (treat as not existing) if HEAD is not supported (405).
     * No body is transferred.
     */
    async fileExists(cdnId: string, fileName: string): Promise<boolean> {
        return (await this.getFileMetadata(cdnId, fileName)).exists;
    }

    /**
     * Uploads a file buffer to the Whaly CDN.
     * The PUT is idempotent — uploading the same fileName overwrites the existing file.
     */
    async uploadFile(
        cdnId: string,
        fileName: string,
        fileBuffer: Buffer,
    ): Promise<CdnUploadResult> {
        const url = `/v1/cdn/${cdnId}/files/${encodeURIComponent(fileName)}`;
        try {
            logger.info(`${logPrefix} Uploading ${fileName} (${fileBuffer.length} bytes) to CDN ${cdnId}`);

            const form = new FormData();
            form.append("file", new Blob([fileBuffer]), fileName);

            const response = await this.axiosClient.put(url, form);

            logger.info(`${logPrefix} Successfully uploaded ${fileName} (status ${response.status})`);

            return {
                filePath: response.data?.filePath ?? `/org/${cdnId}/file/${fileName}`,
            };
        } catch (err) {
            if (axios.isAxiosError(err)) {
                this.throwMeaningfulError(err);
            }
            throw err;
        }
    }

    private throwMeaningfulError(err: import("axios").AxiosError): never {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
            throw new Error("Unauthorized - invalid or expired service account key");
        } else if (status === 404) {
            throw new Error("Organization or CDN not found");
        } else if (status === 500) {
            throw new Error("API server error - check CDN ID and service account permissions");
        } else {
            throw new Error(`API error: ${err.response?.statusText ?? err.message}`);
        }
    }
}
