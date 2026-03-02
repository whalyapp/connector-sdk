/**
 * Metadata-only representation of a document in the source system.
 * Yielded by DocumentStream.listDocuments().
 */
export interface DocumentEntry {
    /** Unique ID in source system — the reconciliation key. */
    externalId: string;
    /** Display name in Whaly. */
    fileName: string;
    /** Original filename in source system. */
    originalFileName: string;
    /** Original file path in source system. */
    originalFilePath?: string;
    /** Document author name. */
    originalAuthor?: string;
    /** File extension without dot (e.g. "pdf", "xlsx"). */
    extension: string;
    /** Source last-modified timestamp. Used for incremental skip. */
    lastModified?: Date;
    /** ISO date string: when the document becomes valid. */
    validFrom?: string;
    /** ISO date string: when the document expires. */
    validUntil?: string;
    /** Custom key-value metadata. */
    metadata?: Record<string, string>;
}

/**
 * A document as it exists in Whaly (returned by the Document API).
 */
export interface WhalyDocument {
    id: string;
    file_name: string;
    external_id: string;
    original_file_name: string;
    original_file_path: string;
    original_author: string;
    extension: string;
    file_path: string;
    valid_from: string;
    valid_until: string;
    size_kb: number;
    storage: string;
    metadata: Record<string, string> | null;
}

/** Paginated response from the Whaly Document API. */
export interface WhalyPaginatedResponse<T> {
    data: T[];
    paging: {
        next?: { after: string };
    };
}

export type DocumentStatus = "created" | "updated" | "reuploaded" | "deleted" | "skipped" | "error";

export interface DocumentManifestEntry {
    externalId: string;
    fileName: string;
    status: DocumentStatus;
    error?: string;
}

export interface DocumentStreamManifest {
    streamId: string;
    syncedAt: string;
    documents: DocumentManifestEntry[];
    summary: DocumentSummary;
}

export interface DocumentSummary {
    total: number;
    created: number;
    updated: number;
    reuploaded: number;
    deleted: number;
    skipped: number;
    errors: number;
}

export interface DocumentManifest {
    syncedAt: string;
    streams: DocumentStreamManifest[];
    summary: DocumentSummary;
}

export function emptyDocumentSummary(): DocumentSummary {
    return { total: 0, created: 0, updated: 0, reuploaded: 0, deleted: 0, skipped: 0, errors: 0 };
}

export function addDocumentSummaries(a: DocumentSummary, b: DocumentSummary): DocumentSummary {
    return {
        total: a.total + b.total,
        created: a.created + b.created,
        updated: a.updated + b.updated,
        reuploaded: a.reuploaded + b.reuploaded,
        deleted: a.deleted + b.deleted,
        skipped: a.skipped + b.skipped,
        errors: a.errors + b.errors,
    };
}
