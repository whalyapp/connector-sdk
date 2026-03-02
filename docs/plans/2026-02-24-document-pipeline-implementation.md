# Document Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Document Tap/Stream/Target pipeline in connector-sdk that encapsulates full reconciliation logic (create/update/reupload/delete) so script writers only implement `listDocuments()` and `downloadDocument()`.

**Architecture:** Mirrors the existing Asset pipeline (`AssetTap → AssetStream → AssetTarget`) but adds reconciliation (diff source vs target), metadata-only updates, and hard deletion detection. The `DocumentTap` base class owns the full sync protocol. `WhalyDocumentTarget` is a concrete class wrapping the Whaly Document API. Script writers extend `DocumentStream` and `DocumentTap`.

**Tech Stack:** TypeScript (strict mode), vitest for tests, axios with retry for HTTP, fs-extra for file ops.

**Design doc:** `docs/plans/2026-02-24-document-pipeline-design.md`

---

### Task 1: Document types (`src/sdk/models/document-tap/types.ts`)

**Files:**
- Create: `src/sdk/models/document-tap/types.ts`
- Test: `src/sdk/models/document-tap/types.test.ts`

**Step 1: Write the types file**

Create `src/sdk/models/document-tap/types.ts` with all document pipeline types:

```typescript
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
    metadata: Record<string, string>;
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
```

**Step 2: Write tests for helper functions**

Create `src/sdk/models/document-tap/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { emptyDocumentSummary, addDocumentSummaries } from "./types";

describe("DocumentSummary helpers", () => {
    it("emptyDocumentSummary returns all zeros", () => {
        const s = emptyDocumentSummary();
        expect(s).toEqual({ total: 0, created: 0, updated: 0, reuploaded: 0, deleted: 0, skipped: 0, errors: 0 });
    });

    it("addDocumentSummaries sums each field", () => {
        const a = { total: 3, created: 1, updated: 1, reuploaded: 0, deleted: 0, skipped: 1, errors: 0 };
        const b = { total: 2, created: 0, updated: 0, reuploaded: 1, deleted: 1, skipped: 0, errors: 0 };
        expect(addDocumentSummaries(a, b)).toEqual({
            total: 5, created: 1, updated: 1, reuploaded: 1, deleted: 1, skipped: 1, errors: 0,
        });
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/sdk/models/document-tap/types.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sdk/models/document-tap/types.ts src/sdk/models/document-tap/types.test.ts
git commit -m "feat(document): add document pipeline types and helpers"
```

---

### Task 2: DocumentStream base class (`src/sdk/models/document-tap/document-stream.ts`)

**Files:**
- Create: `src/sdk/models/document-tap/document-stream.ts`
- Test: `src/sdk/models/document-tap/document-stream.test.ts`

**Step 1: Write the DocumentStream class**

Create `src/sdk/models/document-tap/document-stream.ts`:

```typescript
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
     * Default: true if source lastModified > existing doc's update time,
     * or if either timestamp is missing.
     */
    shouldReupload(sourceEntry: DocumentEntry, _existingDoc: WhalyDocument): boolean {
        if (sourceEntry.lastModified === undefined) return true;
        // WhalyDocument doesn't expose a lastModified timestamp directly,
        // so the default is conservative: always re-upload.
        // Implementors can override with custom logic.
        return true;
    }

    /**
     * Escape hatch: does the metadata need updating?
     * Default: compares fileName, validFrom, validUntil, originalAuthor, metadata.
     */
    shouldUpdateMetadata(sourceEntry: DocumentEntry, existingDoc: WhalyDocument): boolean {
        if (sourceEntry.fileName !== existingDoc.file_name) return true;
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
```

**Step 2: Write tests for default escape hatches**

Create `src/sdk/models/document-tap/document-stream.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DocumentStream } from "./document-stream";
import type { DocumentEntry, WhalyDocument } from "./types";

class TestStream extends DocumentStream<{}> {
    private items: DocumentEntry[];
    constructor(items: DocumentEntry[] = []) {
        super("test-stream", {});
        this.items = items;
    }
    async *listDocuments() {
        for (const item of this.items) yield item;
    }
    async downloadDocument(_entry: DocumentEntry, _destPath: string) {
        // no-op for tests
    }
}

function makeWhalyDoc(overrides: Partial<WhalyDocument> = {}): WhalyDocument {
    return {
        id: "doc-1",
        file_name: "test.pdf",
        external_id: "ext-1",
        original_file_name: "test.pdf",
        original_file_path: "/path/test.pdf",
        original_author: "Author",
        extension: "pdf",
        file_path: "stream/ext-1.pdf",
        valid_from: "2024-01-01",
        valid_until: "2025-01-01",
        size_kb: 100,
        storage: "storage-1",
        metadata: {},
        ...overrides,
    };
}

describe("DocumentStream", () => {
    describe("shouldReupload", () => {
        it("returns true by default (conservative)", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf", lastModified: new Date(),
            };
            expect(stream.shouldReupload(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when lastModified is undefined", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf",
            };
            expect(stream.shouldReupload(entry, makeWhalyDoc())).toBe(true);
        });
    });

    describe("shouldUpdateMetadata", () => {
        it("returns false when all fields match", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(false);
        });

        it("returns true when fileName differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "new-name.pdf", originalFileName: "test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when metadata differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: { tag: "new" },
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when validFrom differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf", validFrom: "2024-06-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });
    });

    describe("shouldDelete", () => {
        it("returns true by default", () => {
            const stream = new TestStream();
            expect(stream.shouldDelete(makeWhalyDoc())).toBe(true);
        });
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/sdk/models/document-tap/document-stream.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sdk/models/document-tap/document-stream.ts src/sdk/models/document-tap/document-stream.test.ts
git commit -m "feat(document): add DocumentStream base class with escape hatches"
```

---

### Task 3: WhalyDocumentService (`src/services/whaly-document.ts`)

HTTP client for the Whaly Document API. Follows the same pattern as `CdnService` (`src/services/cdn.ts`): axios instance with retry, explicit config with env fallbacks.

**Files:**
- Create: `src/services/whaly-document.ts`
- Test: `src/services/whaly-document.test.ts`

**Step 1: Write the service**

Create `src/services/whaly-document.ts`:

```typescript
import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import fs from "node:fs";
import path from "node:path";
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

    private throwMeaningfulError(err: AxiosError): never {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
            throw new Error("Unauthorized — invalid or expired service account key");
        } else if (status === 404) {
            throw new Error("Document or resource not found");
        } else if (status === 500) {
            throw new Error("API server error");
        } else {
            throw new Error(`API error: ${err.response?.statusText ?? err.message}`);
        }
    }
}
```

**Step 2: Write basic tests (mocking axios)**

Create `src/services/whaly-document.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WhalyDocument } from "../sdk/models/document-tap/types";

// We test that the service constructs correctly and the pagination loop works.
// Actual HTTP calls are mocked at integration test level.

describe("WhalyDocumentService", () => {
    beforeEach(() => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
    });

    it("constructs without error when env vars are set", async () => {
        const { WhalyDocumentService } = await import("./whaly-document");
        const service = new WhalyDocumentService({ objectStorageId: "objst_test" });
        expect(service.objectStorageId).toBe("objst_test");
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/services/whaly-document.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/services/whaly-document.ts src/services/whaly-document.test.ts
git commit -m "feat(document): add WhalyDocumentService HTTP client"
```

---

### Task 4: WhalyDocumentTarget (`src/sdk/models/document-target/whaly-document-target.ts`)

Wraps `WhalyDocumentService` with document-level operations (create with upload, reupload, metadata-only update, delete). This is the concrete target class script writers instantiate.

**Files:**
- Create: `src/sdk/models/document-target/whaly-document-target.ts`
- Test: `src/sdk/models/document-target/whaly-document-target.test.ts`

**Step 1: Write the target class**

Create `src/sdk/models/document-target/whaly-document-target.ts`:

```typescript
import fs from "fs-extra";
import path from "node:path";
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
```

**Step 2: Write basic construction test**

Create `src/sdk/models/document-target/whaly-document-target.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("WhalyDocumentTarget", () => {
    beforeEach(() => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
    });

    it("constructs without error", async () => {
        const { WhalyDocumentTarget } = await import("./whaly-document-target");
        const target = new WhalyDocumentTarget({ objectStorageId: "objst_test" });
        expect(target.config.objectStorageId).toBe("objst_test");
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/sdk/models/document-target/whaly-document-target.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sdk/models/document-target/whaly-document-target.ts src/sdk/models/document-target/whaly-document-target.test.ts
git commit -m "feat(document): add WhalyDocumentTarget wrapping the Document API"
```

---

### Task 5: DocumentTap — the reconciliation engine (`src/sdk/models/document-tap/document-tap.ts`)

This is the core of the feature. The `DocumentTap` class orchestrates the full sync:
1. List source docs from stream
2. List existing docs from target
3. Diff to compute creates/reuploads/metadata-updates/deletes/skips
4. Execute operations concurrently
5. Write manifest

**Files:**
- Create: `src/sdk/models/document-tap/document-tap.ts`
- Test: `src/sdk/models/document-tap/document-tap.test.ts`

**Step 1: Write the DocumentTap class**

Create `src/sdk/models/document-tap/document-tap.ts`:

```typescript
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../../service/logger";
import { runWithConcurrency } from "../../service/concurrency";
import { isDryRun, getDryRunLimit } from "../../service/dryRun";
import type { DocumentStream } from "./document-stream";
import type { WhalyDocumentTarget } from "../document-target/whaly-document-target";
import type {
    DocumentEntry,
    WhalyDocument,
    DocumentManifest,
    DocumentManifestEntry,
    DocumentStreamManifest,
    DocumentSummary,
} from "./types";
import { emptyDocumentSummary, addDocumentSummaries } from "./types";

const logPrefix = "[DocumentTap]";

interface DiffResult {
    toCreate: DocumentEntry[];
    toReupload: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }>;
    toUpdateMetadata: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }>;
    toDelete: WhalyDocument[];
    skipped: DocumentEntry[];
}

export abstract class DocumentTap<C> {
    readonly config: C;
    readonly outputDir: string;
    readonly streams: DocumentStream<unknown>[] = [];
    readonly concurrency: number;

    target!: WhalyDocumentTarget;

    constructor(config: C, outputDir = "out", concurrency = 5) {
        this.config = config;
        this.outputDir = outputDir;
        this.concurrency = concurrency;
    }

    /** Register streams. Called once at the start of sync(). */
    abstract init(): Promise<void>;

    async sync(): Promise<DocumentManifest> {
        await this.init();

        if (!this.target) {
            throw new Error(`${logPrefix} No target set. Assign a WhalyDocumentTarget before calling sync().`);
        }

        const dryRun = isDryRun();
        const dryRunLimit = dryRun ? getDryRunLimit() : undefined;
        if (dryRun) {
            logger.info(`${logPrefix} [DRY_RUN] mode active — skipping API calls and uploads`);
            await fs.emptyDir(this.outputDir);
            if (dryRunLimit !== undefined) {
                logger.info(`${logPrefix} [DRY_RUN] Limit: ${dryRunLimit} documents per stream`);
            }
        }

        const tmpDir = path.join(this.outputDir, "tmp");
        await fs.ensureDir(tmpDir);

        const streamManifests: DocumentStreamManifest[] = [];
        let totalSummary = emptyDocumentSummary();

        for (const stream of this.streams) {
            logger.info(`${logPrefix} Processing stream: ${stream.streamId}`);

            // 1. LIST PHASE
            const sourceEntries = await this.collectSourceEntries(stream, dryRunLimit);
            const existingDocs = dryRun ? [] : await this.target.listExistingDocuments();

            // 2. DIFF PHASE
            const diff = this.computeDiff(stream, sourceEntries, existingDocs);

            logger.info(`${logPrefix} Stream ${stream.streamId} diff: ` +
                `create=${diff.toCreate.length} reupload=${diff.toReupload.length} ` +
                `updateMeta=${diff.toUpdateMetadata.length} delete=${diff.toDelete.length} ` +
                `skip=${diff.skipped.length}`);

            // 3. EXECUTE PHASE
            const entries: DocumentManifestEntry[] = [];

            // Creates (need download)
            const createTasks = diff.toCreate.map(entry => async () => {
                return this.executeCreate(stream, entry, tmpDir, dryRun);
            });

            // Reuploads (need download)
            const reuploadTasks = diff.toReupload.map(({ entry, existingDoc }) => async () => {
                return this.executeReupload(stream, entry, existingDoc, tmpDir, dryRun);
            });

            // Metadata-only updates (no download)
            const metadataTasks = diff.toUpdateMetadata.map(({ entry, existingDoc }) => async () => {
                return this.executeMetadataUpdate(entry, existingDoc, dryRun);
            });

            // Deletes
            const deleteTasks = diff.toDelete.map(doc => async () => {
                return this.executeDelete(doc, dryRun);
            });

            // Run all tasks with concurrency
            const allTasks = [...createTasks, ...reuploadTasks, ...metadataTasks, ...deleteTasks];
            const results = await runWithConcurrency(allTasks, this.concurrency);
            entries.push(...results);

            // Add skipped entries
            for (const entry of diff.skipped) {
                entries.push({ externalId: entry.externalId, fileName: entry.fileName, status: "skipped" });
            }

            // 4. MANIFEST PHASE
            const streamSummary = this.computeSummary(entries);
            totalSummary = addDocumentSummaries(totalSummary, streamSummary);

            streamManifests.push({
                streamId: stream.streamId,
                syncedAt: new Date().toISOString(),
                documents: entries,
                summary: streamSummary,
            });
        }

        const manifest: DocumentManifest = {
            syncedAt: new Date().toISOString(),
            streams: streamManifests,
            summary: totalSummary,
        };

        await fs.ensureDir(this.outputDir);
        await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

        // Cleanup tmp
        await fs.remove(tmpDir).catch(() => undefined);

        logger.info(`${logPrefix} Sync complete. Created=${totalSummary.created} Updated=${totalSummary.updated} ` +
            `Reuploaded=${totalSummary.reuploaded} Deleted=${totalSummary.deleted} ` +
            `Skipped=${totalSummary.skipped} Errors=${totalSummary.errors}`);

        return manifest;
    }

    private async collectSourceEntries(stream: DocumentStream<unknown>, limit?: number): Promise<DocumentEntry[]> {
        const entries: DocumentEntry[] = [];
        for await (const entry of stream.listDocuments()) {
            entries.push(entry);
            if (limit !== undefined && entries.length >= limit) break;
        }
        return entries;
    }

    private computeDiff(
        stream: DocumentStream<unknown>,
        sourceEntries: DocumentEntry[],
        existingDocs: WhalyDocument[],
    ): DiffResult {
        const existingByExternalId = new Map<string, WhalyDocument>();
        for (const doc of existingDocs) {
            existingByExternalId.set(doc.external_id, doc);
        }

        const toCreate: DocumentEntry[] = [];
        const toReupload: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }> = [];
        const toUpdateMetadata: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }> = [];
        const skipped: DocumentEntry[] = [];
        const matchedExternalIds = new Set<string>();

        for (const entry of sourceEntries) {
            const existing = existingByExternalId.get(entry.externalId);
            if (!existing) {
                toCreate.push(entry);
            } else {
                matchedExternalIds.add(entry.externalId);
                const needsReupload = stream.shouldReupload(entry, existing);
                if (needsReupload) {
                    toReupload.push({ entry, existingDoc: existing });
                } else {
                    const needsMetaUpdate = stream.shouldUpdateMetadata(entry, existing);
                    if (needsMetaUpdate) {
                        toUpdateMetadata.push({ entry, existingDoc: existing });
                    } else {
                        skipped.push(entry);
                    }
                }
            }
        }

        // Documents in Whaly but not in source → candidates for deletion
        const toDelete: WhalyDocument[] = [];
        for (const doc of existingDocs) {
            if (!matchedExternalIds.has(doc.external_id) && !sourceEntries.some(e => e.externalId === doc.external_id)) {
                if (stream.shouldDelete(doc)) {
                    toDelete.push(doc);
                }
            }
        }

        return { toCreate, toReupload, toUpdateMetadata, toDelete, skipped };
    }

    private async executeCreate(
        stream: DocumentStream<unknown>,
        entry: DocumentEntry,
        tmpDir: string,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        const downloadPath = path.join(tmpDir, `${entry.externalId}.${entry.extension}`);
        try {
            await stream.downloadDocument(entry, downloadPath);

            if (!dryRun) {
                await this.target.createDocument(stream.streamId, entry, downloadPath);
            } else {
                const inspectPath = path.join(this.outputDir, stream.streamId, `${entry.externalId}.${entry.extension}`);
                await fs.ensureDir(path.dirname(inspectPath));
                await fs.copy(downloadPath, inspectPath);
            }

            return { externalId: entry.externalId, fileName: entry.fileName, status: "created" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to create ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        } finally {
            await fs.remove(downloadPath).catch(() => undefined);
        }
    }

    private async executeReupload(
        stream: DocumentStream<unknown>,
        entry: DocumentEntry,
        existingDoc: WhalyDocument,
        tmpDir: string,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        const downloadPath = path.join(tmpDir, `${entry.externalId}.${entry.extension}`);
        try {
            await stream.downloadDocument(entry, downloadPath);

            if (!dryRun) {
                await this.target.reuploadDocument(stream.streamId, existingDoc.id, entry, downloadPath);
            } else {
                const inspectPath = path.join(this.outputDir, stream.streamId, `${entry.externalId}.${entry.extension}`);
                await fs.ensureDir(path.dirname(inspectPath));
                await fs.copy(downloadPath, inspectPath);
            }

            return { externalId: entry.externalId, fileName: entry.fileName, status: "reuploaded" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to reupload ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        } finally {
            await fs.remove(downloadPath).catch(() => undefined);
        }
    }

    private async executeMetadataUpdate(
        entry: DocumentEntry,
        existingDoc: WhalyDocument,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        try {
            if (!dryRun) {
                await this.target.updateDocumentMetadata(existingDoc.id, entry);
            }
            return { externalId: entry.externalId, fileName: entry.fileName, status: "updated" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to update metadata for ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        }
    }

    private async executeDelete(
        doc: WhalyDocument,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        try {
            if (!dryRun) {
                await this.target.deleteDocument(doc.id, doc.external_id);
            }
            return { externalId: doc.external_id, fileName: doc.file_name, status: "deleted" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to delete ${doc.external_id}: ${message}`);
            return { externalId: doc.external_id, fileName: doc.file_name, status: "error", error: message };
        }
    }

    private computeSummary(entries: DocumentManifestEntry[]): DocumentSummary {
        const summary = emptyDocumentSummary();
        for (const e of entries) {
            summary.total++;
            if (e.status === "created") summary.created++;
            else if (e.status === "updated") summary.updated++;
            else if (e.status === "reuploaded") summary.reuploaded++;
            else if (e.status === "deleted") summary.deleted++;
            else if (e.status === "skipped") summary.skipped++;
            else if (e.status === "error") summary.errors++;
        }
        return summary;
    }
}
```

**Step 2: Write comprehensive tests**

Create `src/sdk/models/document-tap/document-tap.test.ts`. This is the main test file — it tests the full reconciliation logic using stub classes that don't make real HTTP calls:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { DocumentTap } from "./document-tap";
import { DocumentStream } from "./document-stream";
import type { DocumentEntry, WhalyDocument, DocumentManifest } from "./types";
import type { WhalyDocumentTarget } from "../document-target/whaly-document-target";

// ---- Stub Target ----

function makeStubTarget(existingDocs: WhalyDocument[] = []): WhalyDocumentTarget {
    const created: Array<{ streamId: string; entry: DocumentEntry }> = [];
    const reuploaded: Array<{ docId: string; entry: DocumentEntry }> = [];
    const updatedMeta: Array<{ docId: string; entry: DocumentEntry }> = [];
    const deleted: string[] = [];

    return {
        config: { objectStorageId: "objst_test" } as any,
        listExistingDocuments: vi.fn(async () => existingDocs),
        createDocument: vi.fn(async (streamId: string, entry: DocumentEntry, _localFilePath: string) => {
            created.push({ streamId, entry });
        }),
        reuploadDocument: vi.fn(async (streamId: string, docId: string, entry: DocumentEntry, _localFilePath: string) => {
            reuploaded.push({ docId, entry });
        }),
        updateDocumentMetadata: vi.fn(async (docId: string, entry: DocumentEntry) => {
            updatedMeta.push({ docId, entry });
        }),
        deleteDocument: vi.fn(async (docId: string, _externalId: string) => {
            deleted.push(docId);
        }),
        // Expose for assertions
        _created: created,
        _reuploaded: reuploaded,
        _updatedMeta: updatedMeta,
        _deleted: deleted,
    } as any;
}

// ---- Stub Stream ----

class StubStream extends DocumentStream<{}> {
    private items: DocumentEntry[];
    private _shouldReupload: boolean;

    constructor(id: string, items: DocumentEntry[], shouldReupload = true) {
        super(id, {});
        this.items = items;
        this._shouldReupload = shouldReupload;
    }

    async *listDocuments() {
        for (const item of this.items) yield item;
    }

    async downloadDocument(entry: DocumentEntry, destPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, `content-of-${entry.externalId}`);
    }

    shouldReupload(_sourceEntry: DocumentEntry, _existingDoc: WhalyDocument): boolean {
        return this._shouldReupload;
    }
}

// ---- Stub Tap ----

class StubTap extends DocumentTap<{}> {
    private stubStreams: DocumentStream<unknown>[];

    constructor(streams: DocumentStream<unknown>[], outDir: string, concurrency?: number) {
        super({}, outDir, concurrency);
        this.stubStreams = streams;
    }

    async init() {
        for (const s of this.stubStreams) this.streams.push(s);
    }
}

// ---- Helpers ----

function makeEntry(id: string, overrides: Partial<DocumentEntry> = {}): DocumentEntry {
    return {
        externalId: id,
        fileName: `${id}.pdf`,
        originalFileName: `${id}.pdf`,
        extension: "pdf",
        ...overrides,
    };
}

function makeWhalyDoc(externalId: string, overrides: Partial<WhalyDocument> = {}): WhalyDocument {
    return {
        id: `whaly-${externalId}`,
        file_name: `${externalId}.pdf`,
        external_id: externalId,
        original_file_name: `${externalId}.pdf`,
        original_file_path: "",
        original_author: "",
        extension: "pdf",
        file_path: `stream/${externalId}.pdf`,
        valid_from: "",
        valid_until: "",
        size_kb: 100,
        storage: "storage-1",
        metadata: {},
        ...overrides,
    };
}

// ---- Tests ----

describe("DocumentTap", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-tap-test-"));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
        delete process.env["DRY_RUN"];
        delete process.env["DRY_RUN_LIMIT"];
    });

    it("creates documents that are in source but not in target", async () => {
        const entries = [makeEntry("doc-1"), makeEntry("doc-2")];
        const target = makeStubTarget([]); // no existing docs
        const stream = new StubStream("test", entries);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.createDocument).toHaveBeenCalledTimes(2);
        expect(manifest.summary.created).toBe(2);
        expect(manifest.summary.total).toBe(2);
    });

    it("deletes documents that are in target but not in source", async () => {
        const existingDocs = [makeWhalyDoc("orphan-1"), makeWhalyDoc("orphan-2")];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", []); // no source docs
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.deleteDocument).toHaveBeenCalledTimes(2);
        expect(manifest.summary.deleted).toBe(2);
    });

    it("reuploads when shouldReupload returns true for matched docs", async () => {
        const entries = [makeEntry("doc-1")];
        const existingDocs = [makeWhalyDoc("doc-1")];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, true); // shouldReupload=true
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.reuploadDocument).toHaveBeenCalledTimes(1);
        expect(manifest.summary.reuploaded).toBe(1);
    });

    it("updates metadata when shouldReupload=false but metadata differs", async () => {
        const entries = [makeEntry("doc-1", { fileName: "new-name.pdf" })];
        const existingDocs = [makeWhalyDoc("doc-1", { file_name: "old-name.pdf" })];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false); // shouldReupload=false
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.updateDocumentMetadata).toHaveBeenCalledTimes(1);
        expect(manifest.summary.updated).toBe(1);
    });

    it("skips when shouldReupload=false and metadata matches", async () => {
        const entries = [makeEntry("doc-1", { fileName: "doc-1.pdf", validFrom: "", validUntil: "", originalAuthor: "" })];
        const existingDocs = [makeWhalyDoc("doc-1", { file_name: "doc-1.pdf" })];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.createDocument).not.toHaveBeenCalled();
        expect(target.reuploadDocument).not.toHaveBeenCalled();
        expect(target.updateDocumentMetadata).not.toHaveBeenCalled();
        expect(target.deleteDocument).not.toHaveBeenCalled();
        expect(manifest.summary.skipped).toBe(1);
    });

    it("handles mixed operations in a single sync", async () => {
        const entries = [
            makeEntry("new-doc"),                                          // create
            makeEntry("existing-doc", { fileName: "updated-name.pdf" }),   // metadata update
        ];
        const existingDocs = [
            makeWhalyDoc("existing-doc", { file_name: "old-name.pdf" }),
            makeWhalyDoc("orphan-doc"),                                    // delete
        ];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false); // shouldReupload=false
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(manifest.summary.created).toBe(1);
        expect(manifest.summary.updated).toBe(1);
        expect(manifest.summary.deleted).toBe(1);
        expect(manifest.summary.total).toBe(3);
    });

    it("records per-document errors without aborting", async () => {
        const entries = [makeEntry("doc-1"), makeEntry("doc-2")];
        const target = makeStubTarget([]);
        let callCount = 0;
        target.createDocument = vi.fn(async () => {
            callCount++;
            if (callCount === 1) throw new Error("API error");
        }) as any;
        const stream = new StubStream("test", entries);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(manifest.summary.errors).toBe(1);
        expect(manifest.summary.created).toBe(1);
    });

    it("writes manifest.json to outputDir", async () => {
        const target = makeStubTarget([]);
        const stream = new StubStream("test", [makeEntry("doc-1")]);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        await tap.sync();

        const manifestPath = path.join(tmpDir, "manifest.json");
        expect(await fs.pathExists(manifestPath)).toBe(true);
        const manifest: DocumentManifest = await fs.readJson(manifestPath);
        expect(manifest.streams).toHaveLength(1);
        expect(manifest.summary.total).toBe(1);
    });

    it("cleans up tmp files after processing", async () => {
        const target = makeStubTarget([]);
        const stream = new StubStream("test", [makeEntry("doc-1")]);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        await tap.sync();

        const tmpExists = await fs.pathExists(path.join(tmpDir, "tmp"));
        expect(tmpExists).toBe(false);
    });

    it("throws if no target is set", async () => {
        const stream = new StubStream("test", []);
        const tap = new StubTap([stream], tmpDir);
        // tap.target not set

        await expect(tap.sync()).rejects.toThrow("No target set");
    });

    it("respects shouldDelete escape hatch", async () => {
        const existingDocs = [
            makeWhalyDoc("keep-me", { metadata: {} }),
            makeWhalyDoc("delete-me", { metadata: { tag: "sync" } }),
        ];
        const target = makeStubTarget(existingDocs);

        class FilteringStream extends StubStream {
            shouldDelete(doc: WhalyDocument): boolean {
                return Object.keys(doc.metadata).length > 0;
            }
        }

        const stream = new FilteringStream("test", []);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.deleteDocument).toHaveBeenCalledTimes(1);
        expect(manifest.summary.deleted).toBe(1);
        // "keep-me" should not be deleted
        const deletedEntry = manifest.streams[0]?.documents.find(d => d.status === "deleted");
        expect(deletedEntry?.externalId).toBe("delete-me");
    });

    describe("DRY_RUN mode", () => {
        beforeEach(() => { process.env["DRY_RUN"] = "true"; });

        it("does not call target API methods", async () => {
            const entries = [makeEntry("doc-1")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            await tap.sync();

            // In dry-run, listExistingDocuments is NOT called (returns [])
            expect(target.listExistingDocuments).not.toHaveBeenCalled();
            expect(target.createDocument).not.toHaveBeenCalled();
            expect(target.deleteDocument).not.toHaveBeenCalled();
        });

        it("copies downloaded files to out/<streamId>/ for inspection", async () => {
            const entries = [makeEntry("doc-1")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            await tap.sync();

            const inspectPath = path.join(tmpDir, "test", "doc-1.pdf");
            expect(await fs.pathExists(inspectPath)).toBe(true);
        });

        it("DRY_RUN_LIMIT stops after N documents per stream", async () => {
            process.env["DRY_RUN_LIMIT"] = "2";
            const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            const manifest = await tap.sync();

            expect(manifest.summary.total).toBe(2);
        });
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/sdk/models/document-tap/document-tap.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sdk/models/document-tap/document-tap.ts src/sdk/models/document-tap/document-tap.test.ts
git commit -m "feat(document): add DocumentTap with full reconciliation engine"
```

---

### Task 6: Export from `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Step 1: Add exports**

Add the following lines to `src/index.ts` at the end:

```typescript
/**
 * Document Tap / Target (document-level pipeline with reconciliation)
 */
export * from "./sdk/models/document-tap/types";
export * from "./sdk/models/document-tap/document-stream";
export * from "./sdk/models/document-tap/document-tap";
export * from "./sdk/models/document-target/whaly-document-target";
export * from "./services/whaly-document";
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds, CJS + ESM + types emitted

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(document): export document pipeline from public API"
```

---

### Task 7: Final verification

**Step 1: Run full test suite one more time**

Run: `npm test`
Expected: All tests pass (existing + new)

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Verify the exports are accessible**

Run: `node -e "const sdk = require('./dist/index.cjs'); console.log(Object.keys(sdk).filter(k => k.includes('Document')))"`
Expected: Should list `DocumentTap`, `DocumentStream`, `WhalyDocumentTarget`, `WhalyDocumentService`, and all Document types.
