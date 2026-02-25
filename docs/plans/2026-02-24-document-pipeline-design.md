# Document Pipeline Design

## Problem

Script writers need to sync documents (files + metadata) between external sources and the Whaly platform, with full reconciliation, hard deletion detection, and incremental skip optimization. Currently this logic is hand-rolled per project (e.g., Danone Noledge), requiring each script to implement its own diffing, API calls, and error handling.

## Solution

A new Document pipeline in connector-sdk: `DocumentTap -> DocumentStream -> WhalyDocumentTarget`. The SDK encapsulates all reconciliation logic so script writers only implement source listing and file download.

## Key Decisions

1. **Reconciliation in the SDK** - `DocumentTap.sync()` handles list/diff/execute automatically
2. **Full reconciliation every run** - always detects creates, updates, and hard deletes
3. **Metadata-only updates** - file re-upload only when `lastModified` changes
4. **lastModified comparison** - avoids unnecessary downloads
5. **Concrete Whaly target** - `WhalyDocumentTarget` wraps the Whaly Document API directly
6. **Escape hatches** - `shouldReupload()`, `shouldUpdateMetadata()`, `shouldDelete()` overridable on the stream
7. **DRY_RUN support** - same pattern as Asset pipeline
8. **Manifest** - tracks per-document status (created/updated/reuploaded/deleted/skipped/error)

## Core Abstractions

### DocumentEntry

What a source document looks like (metadata only, no file content):

```typescript
interface DocumentEntry {
  externalId: string;                // Unique ID in source system (reconciliation key)
  fileName: string;                  // Display name
  originalFileName: string;          // Original filename
  originalFilePath?: string;         // Original path in source
  originalAuthor?: string;           // Author name
  extension: string;                 // File extension (pdf, xlsx, etc.)
  lastModified?: Date;               // For incremental skip check
  validFrom?: string;                // Validity start
  validUntil?: string;               // Validity end
  metadata?: Record<string, string>; // Custom key-value metadata
}
```

### DocumentStream<C>

What script writers implement:

```typescript
abstract class DocumentStream<C> {
  abstract streamId: string;
  abstract config: C;

  // Required: yield all documents from source (metadata only)
  abstract listDocuments(): AsyncIterable<DocumentEntry>;

  // Required: download a single document file to destPath
  abstract downloadDocument(entry: DocumentEntry, destPath: string): Promise<void>;

  // Escape hatch: override to customize when a file should be re-uploaded
  // Default: true if source lastModified > target lastModified, or if no timestamps
  shouldReupload(sourceEntry: DocumentEntry, existingDoc: WhalyDocument): boolean;

  // Escape hatch: override to customize when metadata needs updating
  // Default: compares fileName, validFrom, validUntil, metadata, author
  shouldUpdateMetadata(sourceEntry: DocumentEntry, existingDoc: WhalyDocument): boolean;

  // Escape hatch: override to filter which deletions to apply
  // Default: returns true (delete all orphaned docs)
  shouldDelete(orphanedDoc: WhalyDocument): boolean;
}
```

### DocumentTap<C>

SDK orchestrator. Script writers extend it to register streams, but reconciliation is not overridable:

```typescript
abstract class DocumentTap<C> {
  abstract config: C;
  streams: DocumentStream<unknown>[];
  target: WhalyDocumentTarget;
  concurrency: number; // default: 5

  // Script writers implement to register streams
  abstract init(): Promise<void>;

  // SDK provides the full sync - not overridable
  async sync(): Promise<DocumentManifest>;
}
```

### WhalyDocumentTarget

Concrete SDK-provided class. Script writers instantiate it, they don't extend it:

```typescript
interface WhalyDocumentTargetConfig {
  apiEndpoint: string;        // Whaly API base URL
  serviceAccountKey: string;  // Bearer token
  objectStorageId: string;    // Storage bucket ID
}

class WhalyDocumentTarget {
  async listExistingDocuments(): Promise<WhalyDocument[]>;
  async createDocument(entry: DocumentEntry, filePath: string): Promise<void>;
  async updateDocumentMetadata(docId: string, entry: DocumentEntry): Promise<void>;
  async reuploadDocument(docId: string, entry: DocumentEntry, filePath: string): Promise<void>;
  async deleteDocument(docId: string): Promise<void>;
}
```

## Sync Protocol

```
For each DocumentStream:

  1. LIST PHASE (metadata only, no downloads)
     source[]   <- stream.listDocuments()
     existing[] <- target.listExistingDocuments()

  2. DIFF PHASE (index by externalId)
     toCreate[]     <- in source, not in existing
     toDelete[]     <- in existing, not in source (filtered by shouldDelete())
     matched[]      <- in both
       toReupload[] <- shouldReupload() returns true
       toUpdateMeta[] <- shouldUpdateMetadata() returns true
       skipped[]    <- neither

  3. EXECUTE PHASE (concurrent, up to tap.concurrency)
     Creates:    download -> upload file -> create document record
     Reuploads:  download -> reupload file + update metadata
     Meta-only:  update document record (no download)
     Deletes:    delete document record

  4. MANIFEST PHASE
     Record per-document status + stream summary
```

## API Mapping

| SDK Operation | HTTP Call(s) |
|---|---|
| `listExistingDocuments()` | `GET /v1/documents` (paginated, cursor-based) |
| `createDocument(entry, filePath)` | `POST /v1/object-storages/{id}/upload` then `POST /v1/documents` |
| `reuploadDocument(docId, entry, filePath)` | `POST /v1/object-storages/{id}/upload` then `PUT /v1/documents/{id}` |
| `updateDocumentMetadata(docId, entry)` | `PUT /v1/documents/{id}` (no file upload) |
| `deleteDocument(docId)` | `DELETE /v1/documents/{id}` |

File path convention in object storage: `{streamId}/{externalId}.{extension}`

## Manifest Structure

```typescript
interface DocumentManifest {
  syncedAt: string;
  streams: DocumentStreamManifest[];
  summary: {
    total: number;
    created: number;
    updated: number;
    reuploaded: number;
    deleted: number;
    skipped: number;
    errors: number;
  };
}

interface DocumentManifestEntry {
  externalId: string;
  fileName: string;
  status: "created" | "updated" | "reuploaded" | "deleted" | "skipped" | "error";
  error?: string;
}
```

## DRY_RUN Support

Same pattern as Asset pipeline:
- Skips actual API calls (create/update/delete) and file uploads
- Downloads files to `out/{streamId}/` for inspection
- Respects `DRY_RUN_LIMIT` per stream
- Manifest still written with what would happen

## Script Writer Example

```typescript
class NoledgeStream extends DocumentStream<NoledgeConfig> {
  streamId = "noledge-docs";

  async *listDocuments(): AsyncIterable<DocumentEntry> {
    const docs = await this.fetchListeDocsJson();
    for (const doc of docs) {
      yield {
        externalId: doc.FileId,
        fileName: doc.Label,
        originalFileName: doc.OriginalFileName,
        originalAuthor: doc.AuthorName,
        extension: doc.Extension,
        lastModified: new Date(doc.UpdateDate),
        validFrom: doc.AvailableDate,
        validUntil: doc.ExpireDate,
        metadata: { search_tags: doc.SearchTags },
      };
    }
  }

  async downloadDocument(entry: DocumentEntry, destPath: string): Promise<void> {
    await sftp.fastGet(`/files/${entry.externalId}.${entry.extension}`, destPath);
  }

  // Optional: only delete docs that have search_tags (safety filter)
  shouldDelete(orphanedDoc: WhalyDocument): boolean {
    return (orphanedDoc.metadata?.search_tags?.length ?? 0) > 0;
  }
}

class NoledgeTap extends DocumentTap<NoledgeConfig> {
  async init() {
    this.streams = [new NoledgeStream(this.config)];
  }
}

const tap = new NoledgeTap(config);
tap.target = new WhalyDocumentTarget(whalyConfig);
await tap.sync();
```

## New Files

- `src/sdk/models/document-tap/document-tap.ts` - DocumentTap base class
- `src/sdk/models/document-tap/document-stream.ts` - DocumentStream base class
- `src/sdk/models/document-tap/types.ts` - DocumentEntry, DocumentManifest, etc.
- `src/sdk/models/document-target/whaly-document-target.ts` - WhalyDocumentTarget
- Exported from `src/index.ts`
