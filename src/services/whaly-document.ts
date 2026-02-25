import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import fs from "node:fs";
import FormData from "form-data";
import { logger } from "../sdk/service/logger";
import { getApiEndpoint } from "../sdk/service/apiEndpoint";
import { getServiceAccountKey } from "../sdk/service/serviceAccountKey";
import type { WhalyDocument, WhalyPaginatedResponse } from "../sdk/models/document-tap/types";

const logPrefix = "[WhalyDocumentService]";
const MAX_RETRIES = 10;

export interface WhalyDocumentServiceConfig {
    /** e.g. "https://org.my.whaly.io" */
    apiEndpoint?: string;
    /** e.g. "sk:xxxx" */
    serviceAccountKey?: string;
    /** Object storage ID for file uploads. */
    objectStorageId: string;
}

export interface WhalyUploadResult {
    storage: string;
    filePath: string;
    sizeKb: number;
}

export class WhalyDocumentService {
    private axiosClient: AxiosInstance;
    readonly objectStorageId: string;

    constructor(config: WhalyDocumentServiceConfig) {
        const resolvedKey = getServiceAccountKey(config.serviceAccountKey);
        const resolvedEndpoint = getApiEndpoint(config.apiEndpoint);
        this.objectStorageId = config.objectStorageId;

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
                        logger.info(`${logPrefix} Rate limited — waiting ${seconds}s, attempt ${retryCount}/${MAX_RETRIES}`);
                        return seconds * 1000;
                    }
                }
                const delay = axiosRetry.exponentialDelay(retryCount);
                logger.info(`${logPrefix} Retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES}) for ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
                return delay;
            },
        });
    }

    /** Fetch all documents from the API, handling cursor-based pagination. */
    async listAllDocuments(): Promise<WhalyDocument[]> {
        const documents: WhalyDocument[] = [];
        let after: string | undefined;

        while (true) {
            const params: Record<string, string> = {};
            if (after) params["after"] = after;

            const response = await this.axiosClient.get<WhalyPaginatedResponse<WhalyDocument>>(
                "/v1/documents",
                { params },
            );

            documents.push(...response.data.data);

            const nextAfter = response.data.paging?.next?.after;
            if (!nextAfter) break;
            after = nextAfter;
        }

        logger.info(`${logPrefix} Fetched ${documents.length} existing documents from Whaly`);
        return documents;
    }

    /** Upload a file to object storage. Returns storage path and size. */
    async uploadFile(destinationPath: string, localFilePath: string, fileName: string): Promise<WhalyUploadResult> {
        const form = new FormData();
        form.append("file", fs.createReadStream(localFilePath), fileName);

        const response = await this.axiosClient.post(
            `/v1/object-storages/${this.objectStorageId}/upload`,
            form,
            {
                headers: form.getHeaders(),
                params: { path: destinationPath },
            },
        );

        return response.data.data ?? response.data;
    }

    /** Create a new document record. */
    async createDocument(payload: Omit<WhalyDocument, "id">): Promise<WhalyDocument> {
        const response = await this.axiosClient.post("/v1/documents", payload);
        return response.data.data ?? response.data;
    }

    /** Update an existing document record. */
    async updateDocument(id: string, payload: Partial<WhalyDocument>): Promise<WhalyDocument> {
        const response = await this.axiosClient.put(`/v1/documents/${id}`, payload);
        return response.data.data ?? response.data;
    }

    /** Delete a document record. */
    async deleteDocument(id: string): Promise<void> {
        await this.axiosClient.delete(`/v1/documents/${id}`);
    }
}
