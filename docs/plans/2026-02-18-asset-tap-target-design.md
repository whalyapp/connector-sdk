# Asset Tap / Target Protocol Design

**Date:** 2026-02-18
**Branch:** `Feat-AddCDNUploadCapability`
**Status:** Approved

---

## Overview

A new file-level pipeline protocol (`AssetTap` / `AssetTarget`) for syncing files from various sources (SFTP, APIs, local FS) to upload destinations like the Whaly CDN. Parallel to but separate from the existing data tap/target protocol (which is record-level).

Key characteristics:
- Files stream lazily via `AsyncIterable<AssetEntry>` (scales to large file sets)
- Optional per-file transforms (webp conversion, resize via ImageMagick)
- FULL / INCREMENTAL replication modes (mirrors data tap concept)
- Output lands in `out/` with a `manifest.json` for inspection and testing

---

## Core Types

```typescript
// src/sdk/models/asset-tap/types.ts

type AssetReplicationMode = "FULL" | "INCREMENTAL";

interface AssetEntry {
  /** Path/identifier in the source system (e.g. /remote/images/logo.png) */
  sourcePath: string;
  /** Path in the destination (e.g. logos/logo.webp) */
  destinationPath: string;
  /** Source last-modified timestamp; undefined if unavailable */
  lastModified: Date | undefined;
  /** MIME content type */
  contentType: string;
}

interface ProcessedAsset {
  entry: AssetEntry;
  /** Where the original source file was downloaded (e.g. out/tmp/logo.jpg) */
  downloadedPath: string;
  /**
   * File path ready for upload:
   * - No transform: same as downloadedPath
   * - Transformed: new path (e.g. out/resized_webp/logo.webp)
   */
  uploadPath: string;
  /** True if a transform was applied (downloadedPath !== uploadPath) */
  wasTransformed: boolean;
  size: number;
  contentType: string;
}

interface AssetManifestEntry {
  sourcePath: string;
  destinationPath: string;
  localPath: string;
  size: number;
  contentType: string;
  status: "uploaded" | "skipped" | "error";
  transformed: boolean;
  error?: string;
}

interface AssetManifest {
  syncedAt: string;               // ISO timestamp
  mode: AssetReplicationMode;
  assets: AssetManifestEntry[];
  summary: {
    total: number;
    uploaded: number;
    skipped: number;
    errors: number;
  };
}
```

---

## Class Hierarchy

### `AssetStream<C>` (abstract base)

Located at `src/sdk/models/asset-tap/asset-stream.ts`.

```typescript
abstract class AssetStream<C> {
  streamId: string;
  config: C;
  replicationMode: AssetReplicationMode;  // default: "INCREMENTAL"

  /**
   * Returns an async iterator of file entries from the source.
   * Concrete implementations yield one entry at a time — enables lazy
   * download/transform/upload without loading the full listing into memory.
   */
  abstract listAssets(): AsyncIterable<AssetEntry>;

  /**
   * Optional transform hook. Called after the source file is downloaded.
   *
   * - If no transform is needed: return `downloadedPath` unchanged (default).
   * - If a transform produces a new file: write it to a new path and return
   *   that new path. The tap will clean up `downloadedPath` afterwards.
   *
   * SDK helpers (ImageMagickTransform) make common transforms easy:
   *   return ImageMagickTransform.toWebp(downloadedPath, { width: 250, height: 250 });
   */
  async transformFile(downloadedPath: string, entry: AssetEntry): Promise<string> {
    return downloadedPath;
  }
}
```

### `AssetTap<C>` (abstract orchestrator)

Located at `src/sdk/models/asset-tap/asset-tap.ts`.

```typescript
abstract class AssetTap<C> {
  target: AssetTarget;
  config: C;
  streams: AssetStream<unknown>[];
  outputDir: string;          // defaults to "out/"
  stateProvider: StateProvider;

  abstract init(): Promise<void>;

  async sync(): Promise<AssetManifest> {
    // 1. Call init() — concrete tap registers streams
    // 2. For each stream, for each entry from listAssets():
    //    a. INCREMENTAL mode: check target.shouldSync(entry); skip if false
    //    b. FULL mode: always process
    //    c. Download source file → downloadedPath (out/tmp/...)
    //    d. Call stream.transformFile(downloadedPath, entry) → uploadPath
    //    e. Build ProcessedAsset (tracks both paths, wasTransformed flag)
    //    f. Call target.uploadAsset(processedAsset)
    //    g. Cleanup: delete uploadPath; if wasTransformed, delete downloadedPath too
    //    h. Record result in manifest
    // 3. Write out/manifest.json
    // 4. Call target.complete()
    // 5. Return manifest
  }
}
```

**File lifecycle per asset:**

```
download(entry)         → downloadedPath  (e.g. out/tmp/logo.jpg)
transformFile(...)      → uploadPath
  no transform:           uploadPath === downloadedPath
  transformed:            uploadPath  =   out/resized_webp/logo.webp
target.uploadAsset(...)   uses uploadPath
cleanup:
  always:                 delete uploadPath
  if wasTransformed:      also delete downloadedPath (intermediate)
```

### `AssetTarget<C>` (abstract base)

Located at `src/sdk/models/asset-target/asset-target.ts`.

```typescript
abstract class AssetTarget<C> {
  config: C;
  stateProvider: StateProvider;

  /**
   * INCREMENTAL mode: return true if the file should be synced.
   * Typically compares source lastModified against destination metadata.
   * FULL mode: this method is not called.
   */
  abstract shouldSync(entry: AssetEntry): Promise<boolean>;

  /** Upload the processed (and possibly transformed) file to the destination. */
  abstract uploadAsset(asset: ProcessedAsset): Promise<void>;

  /** Called after all streams have finished. No-op by default. */
  async complete(): Promise<void> {}
}
```

### `CdnAssetTarget` (concrete)

Located at `src/targets/cdn/main.ts`.

```typescript
class CdnAssetTarget extends AssetTarget<CdnAssetTargetConfig> {
  private cdnService: CdnService;

  /** HEAD request via CdnService.getFileMetadata(); compare lastModified. */
  async shouldSync(entry: AssetEntry): Promise<boolean> { ... }

  /** Read file from asset.uploadPath; upload via CdnService.uploadFile(). */
  async uploadAsset(asset: ProcessedAsset): Promise<void> { ... }
}
```

---

## SDK Helpers

### `ImageMagickTransform`

Located at `src/sdk/models/asset-tap/image-magick-transform.ts`.

Wraps `magick mogrify` / `magick convert` shell calls:

```typescript
class ImageMagickTransform {
  static async toWebp(
    inputPath: string,
    options: {
      width?: number;
      height?: number;
      background?: string;
      gravity?: string;
      extent?: boolean;
    }
  ): Promise<string> {
    // Shells out: magick mogrify -path <outputDir> -format webp
    //   [-resize WxH] [-background <bg>] [-gravity <g>] [-extent WxH]
    // Returns path to the new .webp file
  }
}
```

---

## Error Handling

- **Per-file errors** (download failure, transform failure, upload failure) are **non-fatal**. The file is recorded in the manifest with `status: "error"` and an `error` message. Processing continues for remaining files.
- **Stream-level errors** (SFTP connection failure, CDN auth failure) are **fatal** — they bubble up and abort the sync.
- The manifest `summary.errors` count gives a quick health signal.

---

## File Layout

```
src/sdk/models/
  asset-tap/
    types.ts                    — AssetEntry, ProcessedAsset, AssetManifest, etc.
    asset-tap.ts                — AssetTap<C> abstract base
    asset-stream.ts             — AssetStream<C> abstract base
    image-magick-transform.ts   — ImageMagickTransform helper
  asset-target/
    asset-target.ts             — AssetTarget<C> abstract base

src/targets/
  cdn/
    main.ts                     — CdnAssetTarget (concrete)
    models/
      config.ts                 — CdnAssetTargetConfig

src/index.ts                    — export * from new modules
```

---

## Testing Strategy

- **`AssetStream` unit tests:** mock `listAssets()` as an async generator, verify `AssetEntry` shapes; test `transformFile()` with known input images.
- **Integration tests for `AssetTap`:** run `tap.sync()` against a fixture (local FS tap), assert `out/manifest.json` contents and files on disk.
- **`CdnAssetTarget` tests:** mock `CdnService`, verify `shouldSync()` timestamp comparison and upload call arguments.
- **`ImageMagickTransform` tests:** require ImageMagick installed in CI; feed a known JPEG, assert output is valid webp at expected dimensions.

The `out/` directory is the primary test surface — inspecting it gives a complete picture of what would be uploaded.

---

## Sync Flow Summary

```
AssetTap.sync()
  → init()                          // concrete tap registers streams
  → for each stream:
      for await (entry of stream.listAssets()):
        if INCREMENTAL && !target.shouldSync(entry):
          → manifest: status=skipped, continue
        download(entry) → downloadedPath
        stream.transformFile(downloadedPath, entry) → uploadPath
        target.uploadAsset({ entry, downloadedPath, uploadPath, ... })
        cleanup(downloadedPath, uploadPath)
        → manifest: status=uploaded
  → write out/manifest.json
  → target.complete()
  → return manifest
```
