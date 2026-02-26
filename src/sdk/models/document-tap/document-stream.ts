import type { DocumentEntry, WhalyDocument } from "./types";

export abstract class DocumentStream<C> {
    readonly streamId: string;
    readonly config: C;

    constructor(streamId: string, config: C) {
        this.streamId = streamId;
        this.config = config;
    }

    /** Yield all documents from the source (metadata only, no file download). */
    abstract listDocuments(): AsyncIterable<DocumentEntry>;

    /** Download a single document file to `destPath` on local disk. */
    abstract downloadDocument(entry: DocumentEntry, destPath: string): Promise<void>;

    /**
     * Escape hatch: should the file be re-uploaded?
     * Default: true (conservative — always re-upload).
     * Override to compare timestamps or hashes for incremental skip.
     */
    shouldReupload(_sourceEntry: DocumentEntry, _existingDoc: WhalyDocument): boolean {
        return true;
    }

    /**
     * Escape hatch: does the metadata need updating?
     * Default: compares fileName, validFrom, validUntil, originalAuthor, metadata.
     */
    shouldUpdateMetadata(sourceEntry: DocumentEntry, existingDoc: WhalyDocument): boolean {
        if (sourceEntry.fileName !== existingDoc.file_name) return true;
        if (sourceEntry.originalFileName !== existingDoc.original_file_name) return true;
        if ((sourceEntry.originalFilePath ?? "") !== existingDoc.original_file_path) return true;
        if ((sourceEntry.validFrom ?? "") !== existingDoc.valid_from) return true;
        if ((sourceEntry.validUntil ?? "") !== existingDoc.valid_until) return true;
        if ((sourceEntry.originalAuthor ?? "") !== existingDoc.original_author) return true;

        const sourceMetadata = sourceEntry.metadata ?? {};
        const existingMetadata = existingDoc.metadata ?? {};
        const sourceKeys = Object.keys(sourceMetadata).sort();
        const existingKeys = Object.keys(existingMetadata).sort();
        if (sourceKeys.length !== existingKeys.length) return true;
        for (let i = 0; i < sourceKeys.length; i++) {
            if (sourceKeys[i] !== existingKeys[i]) return true;
            if (sourceMetadata[sourceKeys[i]!] !== existingMetadata[existingKeys[i]!]) return true;
        }

        return false;
    }

    /**
     * Escape hatch: should this orphaned document be deleted?
     * Default: true (delete all documents no longer in source).
     */
    shouldDelete(_orphanedDoc: WhalyDocument): boolean {
        return true;
    }
}
