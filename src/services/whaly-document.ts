import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import fs from "node:fs";
import FormData from "form-data";
import { Storage, type Bucket } from "@google-cloud/storage";
import { logger } from "../sdk/service/logger";
import { getApiEndpoint } from "../sdk/service/apiEndpoint";
import { getServiceAccountKey } from "../sdk/service/serviceAccountKey";
import type { WhalyDocument, WhalyPaginatedResponse } from "../sdk/models/document-tap/types";

function enrichAxiosError(err: unknown): Error {
    if (!axios.isAxiosError(err)) return err instanceof Error ? err : new Error(String(err));
    const status = err.response?.status;
    const body = err.response?.data;
    const url = err.config?.url;
    const method = err.config?.method?.toUpperCase();
    const detail = typeof body === "string" ? body : JSON.stringify(body ?? "");
    return new Error(`${method} ${url} failed with status ${status}: ${detail}`, { cause: err });
}

const logPrefix = "[WhalyDocumentService]";
const MAX_RETRIES = 10;

export interface WhalyDocumentServiceConfig {
    /** e.g. "https://org.my.whaly.io" */
    apiEndpoint?: string;
    /** e.g. "sk:xxxx" */
    serviceAccountKey?: string;
    /** Object storage ID for file uploads. */
    objectStorageId: string;
    /**
     * Restrict the sync to these document source IDs.
     *
     * When set (non-empty):
     *  - `listExistingDocuments()` only returns documents belonging to these
     *    sources. This scopes the whole reconciliation (create / update /
     *    delete), so the connector NEVER touches documents from other sources —
     *    important because the DocumentTap deletes any org document not present
     *    in the source.
     *  - New documents are created inside the FIRST configured ID.
     *
     * When empty or omitted, the connector manages ALL documents in the org and
     * creates new documents in the org's default source (previous behaviour).
     */
    documentSourceIds?: string[];
}

export interface WhalyUploadResult {
    storage: string;
    filePath: string;
    sizeKb: number;
}

export class WhalyDocumentService {
    private axiosClient: AxiosInstance;
    readonly objectStorageId: string;
    private gcsBucket: Bucket | undefined;

    constructor(config: WhalyDocumentServiceConfig) {
        const resolvedKey = getServiceAccountKey(config.serviceAccountKey);
        const resolvedEndpoint = getApiEndpoint(config.apiEndpoint);
        this.objectStorageId = config.objectStorageId;

        const gcsBucketName = process.env["WLY_GCS_BUCKET"];
        if (gcsBucketName) {
            this.gcsBucket = new Storage().bucket(gcsBucketName);
            logger.info(`${logPrefix} Using direct GCS upload to bucket: ${gcsBucketName}`);
        }

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

    /**
     * Fetch all documents from the API, handling cursor-based pagination.
     * When `documentSourceId` is provided, only documents belonging to that
     * source are returned (server-side filter).
     */
    async listAllDocuments(documentSourceId?: string): Promise<WhalyDocument[]> {
        const documents: WhalyDocument[] = [];
        let after: string | undefined;

        while (true) {
            const params: Record<string, string> = {};
            if (after) params["after"] = after;
            if (documentSourceId) params["document_source_id"] = documentSourceId;

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
        if (this.gcsBucket) {
            return this.uploadFileViaGCS(destinationPath, localFilePath);
        }
        return this.uploadFileViaAPI(destinationPath, localFilePath, fileName);
    }

    private async uploadFileViaGCS(destinationPath: string, localFilePath: string): Promise<WhalyUploadResult> {
        const bucket = this.gcsBucket;
        if (!bucket) throw new Error("GCS bucket not configured");

        const maxAttempts = MAX_RETRIES + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await bucket.upload(localFilePath, { destination: destinationPath });
                break;
            } catch (err) {
                if (attempt === maxAttempts) throw err;
                const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
                logger.info(`${logPrefix} GCS upload retry ${attempt}/${MAX_RETRIES} in ${delay}ms for ${destinationPath}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        const stat = await fs.promises.stat(localFilePath);
        return {
            storage: this.objectStorageId,
            filePath: destinationPath,
            sizeKb: Math.ceil(stat.size / 1024),
        };
    }

    private async uploadFileViaAPI(destinationPath: string, localFilePath: string, fileName: string): Promise<WhalyUploadResult> {
        const form = new FormData();
        form.append("file", fs.createReadStream(localFilePath), fileName);

        try {
            const response = await this.axiosClient.post(
                `/v1/object-storages/${this.objectStorageId}/upload`,
                form,
                {
                    headers: form.getHeaders(),
                    params: { path: destinationPath },
                },
            );

            return response.data.data ?? response.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }

    /** Create a new document record. */
    async createDocument(payload: Omit<WhalyDocument, "id">): Promise<WhalyDocument> {
        try {
            const response = await this.axiosClient.post("/v1/documents", payload);
            return response.data.data ?? response.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }

    /** Update an existing document record. */
    async updateDocument(id: string, payload: Partial<WhalyDocument>): Promise<WhalyDocument> {
        try {
            const response = await this.axiosClient.put(`/v1/documents/${id}`, { id, ...payload });
            return response.data.data ?? response.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }

    /** Delete a document record. */
    async deleteDocument(id: string): Promise<void> {
        try {
            await this.axiosClient.delete(`/v1/documents/${id}`);
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }
}
