import fs from "fs-extra";
import { logger } from "../../service/logger";
import { WhalyDocumentService } from "../../../services/whaly-document";
import type { WhalyDocumentServiceConfig } from "../../../services/whaly-document";
import type { DocumentEntry, WhalyDocument } from "../document-tap/types";

const logPrefix = "[WhalyDocumentTarget]";

export class WhalyDocumentTarget {
    readonly config: WhalyDocumentServiceConfig;
    private service: WhalyDocumentService;

    constructor(config: WhalyDocumentServiceConfig) {
        this.config = config;
        this.service = new WhalyDocumentService(config);
    }

    /** Fetch all existing documents from Whaly. */
    async listExistingDocuments(): Promise<WhalyDocument[]> {
        return this.service.listAllDocuments();
    }

    /**
     * Create a new document: upload file to object storage, then create the document record.
     * @param streamId Used to namespace the file path in object storage.
     */
    async createDocument(streamId: string, entry: DocumentEntry, localFilePath: string): Promise<void> {
        const destinationPath = `${streamId}/${entry.externalId}.${entry.extension}`;
        const fileName = `${entry.externalId}.${entry.extension}`;

        logger.info(`${logPrefix} Uploading file for new document: ${entry.externalId}`);
        const uploadResult = await this.service.uploadFile(destinationPath, localFilePath, fileName);

        const stat = await fs.stat(localFilePath);

        await this.service.createDocument({
            file_name: entry.fileName,
            external_id: entry.externalId,
            original_file_name: entry.originalFileName,
            original_file_path: entry.originalFilePath ?? "",
            original_author: entry.originalAuthor ?? "",
            extension: entry.extension,
            file_path: uploadResult.filePath,
            valid_from: entry.validFrom ?? "",
            valid_until: entry.validUntil ?? "",
            size_kb: Math.ceil(stat.size / 1024),
            storage: uploadResult.storage,
            metadata: entry.metadata ?? {},
        });

        logger.info(`${logPrefix} Created document: ${entry.externalId} (${entry.fileName})`);
    }

    /**
     * Re-upload the file and update the document record.
     */
    async reuploadDocument(streamId: string, docId: string, entry: DocumentEntry, localFilePath: string): Promise<void> {
        const destinationPath = `${streamId}/${entry.externalId}.${entry.extension}`;
        const fileName = `${entry.externalId}.${entry.extension}`;

        logger.info(`${logPrefix} Re-uploading file for document: ${entry.externalId}`);
        const uploadResult = await this.service.uploadFile(destinationPath, localFilePath, fileName);

        const stat = await fs.stat(localFilePath);

        await this.service.updateDocument(docId, {
            file_name: entry.fileName,
            original_file_name: entry.originalFileName,
            original_file_path: entry.originalFilePath ?? "",
            original_author: entry.originalAuthor ?? "",
            extension: entry.extension,
            file_path: uploadResult.filePath,
            valid_from: entry.validFrom ?? "",
            valid_until: entry.validUntil ?? "",
            size_kb: Math.ceil(stat.size / 1024),
            storage: uploadResult.storage,
            metadata: entry.metadata ?? {},
        });

        logger.info(`${logPrefix} Re-uploaded document: ${entry.externalId} (${entry.fileName})`);
    }

    /** Update only the metadata fields (no file re-upload). */
    async updateDocumentMetadata(docId: string, entry: DocumentEntry): Promise<void> {
        await this.service.updateDocument(docId, {
            file_name: entry.fileName,
            original_file_name: entry.originalFileName,
            original_file_path: entry.originalFilePath ?? "",
            original_author: entry.originalAuthor ?? "",
            valid_from: entry.validFrom ?? "",
            valid_until: entry.validUntil ?? "",
            metadata: entry.metadata ?? {},
        });

        logger.info(`${logPrefix} Updated metadata for document: ${entry.externalId} (${entry.fileName})`);
    }

    /** Delete a document record. */
    async deleteDocument(docId: string, externalId: string): Promise<void> {
        await this.service.deleteDocument(docId);
        logger.info(`${logPrefix} Deleted document: ${externalId} (id=${docId})`);
    }
}
