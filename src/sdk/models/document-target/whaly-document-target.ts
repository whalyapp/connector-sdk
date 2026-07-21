import fs from "fs-extra";
import { logger } from "../../service/logger";
import { WhalyDocumentService } from "../../../services/whaly-document";
import type { WhalyDocumentServiceConfig } from "../../../services/whaly-document";
import type { DocumentEntry, WhalyDocument } from "../document-tap/types";

const logPrefix = "[WhalyDocumentTarget]";

export class WhalyDocumentTarget {
    readonly config: WhalyDocumentServiceConfig;
    private service: WhalyDocumentService;
    /** Document source IDs this target is scoped to (empty = all sources). */
    private readonly documentSourceIds: string[];
    /** Source new documents are created in (`null` = org default source). */
    private readonly createSourceId: string | null;

    constructor(config: WhalyDocumentServiceConfig) {
        this.config = config;
        this.service = new WhalyDocumentService(config);
        this.documentSourceIds = config.documentSourceIds ?? [];
        this.createSourceId = this.documentSourceIds[0] ?? null;
        if (this.documentSourceIds.length > 0) {
            logger.info(
                `${logPrefix} Scoped to document source(s): ${this.documentSourceIds.join(", ")}. ` +
                `New documents will be created in ${this.createSourceId}.`,
            );
        }
    }

    /**
     * Fetch existing documents from Whaly.
     * When scoped to one or more document sources, only documents from those
     * sources are returned — this bounds create/update/delete to those sources.
     */
    async listExistingDocuments(): Promise<WhalyDocument[]> {
        if (this.documentSourceIds.length === 0) {
            return this.service.listAllDocuments();
        }

        const documents: WhalyDocument[] = [];
        for (const sourceId of this.documentSourceIds) {
            const docs = await this.service.listAllDocuments(sourceId);
            documents.push(...docs);
        }
        logger.info(
            `${logPrefix} Fetched ${documents.length} existing documents across ` +
            `${this.documentSourceIds.length} scoped source(s)`,
        );
        return documents;
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
            document_source_id: this.createSourceId,
        });

        logger.info(`${logPrefix} Created document: ${entry.externalId} (${entry.fileName})`);
    }

    /**
     * Re-upload the file and update the document record.
     * `documentSourceId` preserves the document's current source (the API PUT
     * requires this field — omitting it would move the doc to the default source).
     */
    async reuploadDocument(
        streamId: string,
        docId: string,
        entry: DocumentEntry,
        localFilePath: string,
        documentSourceId?: string | null,
    ): Promise<void> {
        const destinationPath = `${streamId}/${entry.externalId}.${entry.extension}`;
        const fileName = `${entry.externalId}.${entry.extension}`;

        logger.info(`${logPrefix} Re-uploading file for document: ${entry.externalId}`);
        const uploadResult = await this.service.uploadFile(destinationPath, localFilePath, fileName);

        const stat = await fs.stat(localFilePath);

        await this.service.updateDocument(docId, {
            external_id: entry.externalId,
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
            document_source_id: documentSourceId === undefined ? this.createSourceId : documentSourceId,
        });

        logger.info(`${logPrefix} Re-uploaded document: ${entry.externalId} (${entry.fileName})`);
    }

    /** Update only the metadata fields (no file re-upload). */
    async updateDocumentMetadata(docId: string, entry: DocumentEntry, existingDoc: WhalyDocument): Promise<void> {
        await this.service.updateDocument(docId, {
            external_id: entry.externalId,
            file_name: entry.fileName,
            original_file_name: entry.originalFileName,
            original_file_path: entry.originalFilePath ?? "",
            original_author: entry.originalAuthor ?? "",
            extension: entry.extension,
            file_path: existingDoc.file_path,
            valid_from: entry.validFrom ?? "",
            valid_until: entry.validUntil ?? "",
            size_kb: existingDoc.size_kb,
            storage: existingDoc.storage,
            metadata: entry.metadata ?? {},
            document_source_id: existingDoc.document_source_id,
        });

        logger.info(`${logPrefix} Updated metadata for document: ${entry.externalId} (${entry.fileName})`);
    }

    /** Delete a document record. */
    async deleteDocument(docId: string, externalId: string): Promise<void> {
        await this.service.deleteDocument(docId);
        logger.info(`${logPrefix} Deleted document: ${externalId} (id=${docId})`);
    }
}
