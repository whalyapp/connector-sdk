# Asset Tap / Target Protocol Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a new file-level pipeline protocol (`AssetTap`/`AssetTarget`) that streams files from sources (SFTP, API, FS) to destinations (CDN), with optional ImageMagick transforms, FULL/INCREMENTAL modes, and `out/` directory output for inspection.

**Architecture:** A separate class hierarchy from the existing data tap/target. `AssetStream` lazily yields `AsyncIterable<AssetEntry>`. `AssetTap` orchestrates download → transform → upload per file. `AssetTarget` is abstract with `CdnAssetTarget` as the first concrete implementation.

**Tech Stack:** TypeScript (strict), vitest, fs-extra (already installed), child_process (stdlib) for ImageMagick shell-out, existing `CdnService` for CDN uploads.

---

## Task 1: Core types

**Files:**
- Create: `src/sdk/models/asset-tap/types.ts`
- Create: `src/sdk/models/asset-tap/types.test.ts`

**Step 1: Write the failing test**

```typescript
// src/sdk/models/asset-tap/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { AssetEntry, ProcessedAsset, AssetManifest, AssetReplicationMode } from "./types";

describe("AssetEntry type", () => {
    it("has correct shape", () => {
        const entry: AssetEntry = {
            sourcePath: "/remote/logo.jpg",
            destinationPath: "logos/logo.webp",
            lastModified: new Date(),
            contentType: "image/jpeg",
        };
        expectTypeOf(entry.lastModified).toEqualTypeOf<Date | undefined>();
    });
});

describe("ProcessedAsset type", () => {
    it("has both downloadedPath and uploadPath", () => {
        const asset: ProcessedAsset = {
            entry: {
                sourcePath: "/remote/logo.jpg",
                destinationPath: "logos/logo.webp",
                lastModified: undefined,
                contentType: "image/jpeg",
            },
            downloadedPath: "out/tmp/logo.jpg",
            uploadPath: "out/resized_webp/logo.webp",
            wasTransformed: true,
            size: 1024,
            contentType: "image/webp",
        };
        expectTypeOf(asset.wasTransformed).toEqualTypeOf<boolean>();
    });
});

describe("AssetManifest type", () => {
    it("has summary with counts", () => {
        const manifest: AssetManifest = {
            syncedAt: new Date().toISOString(),
            mode: "INCREMENTAL",
            assets: [],
            summary: { total: 0, uploaded: 0, skipped: 0, errors: 0 },
        };
        expectTypeOf(manifest.mode).toEqualTypeOf<AssetReplicationMode>();
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/types.test.ts
```

Expected: FAIL with "Cannot find module './types'"

**Step 3: Write implementation**

```typescript
// src/sdk/models/asset-tap/types.ts

export type AssetReplicationMode = "FULL" | "INCREMENTAL";

export interface AssetEntry {
    /** Path/identifier in the source system (e.g. /remote/images/logo.png) */
    sourcePath: string;
    /** Path in the destination (e.g. logos/logo.webp) */
    destinationPath: string;
    /** Source last-modified timestamp; undefined if unavailable */
    lastModified: Date | undefined;
    /** MIME content type */
    contentType: string;
}

export interface ProcessedAsset {
    entry: AssetEntry;
    /** Where the original source file was downloaded (e.g. out/tmp/logo.jpg) */
    downloadedPath: string;
    /**
     * File path ready for upload.
     * - No transform: same reference as downloadedPath
     * - Transformed: a new path produced by transformFile()
     */
    uploadPath: string;
    /** True when a transform was applied (downloadedPath !== uploadPath) */
    wasTransformed: boolean;
    size: number;
    contentType: string;
}

export interface AssetManifestEntry {
    sourcePath: string;
    destinationPath: string;
    /** Local path of the file that was uploaded (uploadPath), for inspection */
    localPath: string;
    size: number;
    contentType: string;
    status: "uploaded" | "skipped" | "error";
    transformed: boolean;
    error?: string;
}

export interface AssetManifest {
    /** ISO 8601 timestamp of when the sync completed */
    syncedAt: string;
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

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/models/asset-tap/types.ts src/sdk/models/asset-tap/types.test.ts
git commit -m "feat: add core AssetTap types (AssetEntry, ProcessedAsset, AssetManifest)"
```

---

## Task 2: AssetStream abstract base

**Files:**
- Create: `src/sdk/models/asset-tap/asset-stream.ts`
- Create: `src/sdk/models/asset-tap/asset-stream.test.ts`

**Step 1: Write the failing test**

```typescript
// src/sdk/models/asset-tap/asset-stream.test.ts
import { describe, it, expect } from "vitest";
import { AssetStream } from "./asset-stream";
import type { AssetEntry } from "./types";

// Minimal concrete subclass for testing
class StubStream extends AssetStream<{ name: string }> {
    private items: AssetEntry[];

    constructor(items: AssetEntry[]) {
        super("stub", { name: "test" }, "INCREMENTAL");
        this.items = items;
    }

    async *listAssets(): AsyncIterable<AssetEntry> {
        for (const item of this.items) {
            yield item;
        }
    }
}

describe("AssetStream", () => {
    it("yields entries from listAssets", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: undefined, contentType: "image/jpeg" },
            { sourcePath: "/b.jpg", destinationPath: "b.jpg", lastModified: new Date("2024-01-01"), contentType: "image/jpeg" },
        ];
        const stream = new StubStream(entries);
        const collected: AssetEntry[] = [];
        for await (const entry of stream.listAssets()) {
            collected.push(entry);
        }
        expect(collected).toHaveLength(2);
        expect(collected[0]?.sourcePath).toBe("/a.jpg");
    });

    it("transformFile returns downloadedPath unchanged by default", async () => {
        const stream = new StubStream([]);
        const entry: AssetEntry = {
            sourcePath: "/a.jpg", destinationPath: "a.jpg",
            lastModified: undefined, contentType: "image/jpeg",
        };
        const result = await stream.transformFile("out/tmp/a.jpg", entry);
        expect(result).toBe("out/tmp/a.jpg");
    });

    it("exposes streamId, config, replicationMode", () => {
        const stream = new StubStream([]);
        expect(stream.streamId).toBe("stub");
        expect(stream.config).toEqual({ name: "test" });
        expect(stream.replicationMode).toBe("INCREMENTAL");
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/asset-stream.test.ts
```

Expected: FAIL with "Cannot find module './asset-stream'"

**Step 3: Write implementation**

```typescript
// src/sdk/models/asset-tap/asset-stream.ts
import type { AssetEntry, AssetReplicationMode } from "./types";

export abstract class AssetStream<C> {
    readonly streamId: string;
    readonly config: C;
    replicationMode: AssetReplicationMode;

    constructor(streamId: string, config: C, replicationMode: AssetReplicationMode = "INCREMENTAL") {
        this.streamId = streamId;
        this.config = config;
        this.replicationMode = replicationMode;
    }

    /**
     * Returns an async iterable of file entries from the source.
     * Concrete implementations yield one entry at a time — the tap processes
     * each entry immediately, keeping memory usage flat even for large sources.
     */
    abstract listAssets(): AsyncIterable<AssetEntry>;

    /**
     * Optional transform hook called after the source file has been downloaded.
     *
     * Default: returns `downloadedPath` unchanged (no transform).
     *
     * Override to apply transforms. If the transform produces a NEW file at a
     * different path, return that new path. The tap will:
     *   - use the returned path for the upload
     *   - clean up both paths after the upload completes
     *
     * Use the `ImageMagickTransform` helper for common image operations:
     *   return ImageMagickTransform.toWebp(downloadedPath, { width: 250, height: 250 });
     */
    async transformFile(downloadedPath: string, _entry: AssetEntry): Promise<string> {
        return downloadedPath;
    }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/asset-stream.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/models/asset-tap/asset-stream.ts src/sdk/models/asset-tap/asset-stream.test.ts
git commit -m "feat: add AssetStream abstract base class"
```

---

## Task 3: AssetTarget abstract base

**Files:**
- Create: `src/sdk/models/asset-target/asset-target.ts`
- Create: `src/sdk/models/asset-target/asset-target.test.ts`

**Step 1: Write the failing test**

```typescript
// src/sdk/models/asset-target/asset-target.test.ts
import { describe, it, expect, vi } from "vitest";
import { AssetTarget } from "./asset-target";
import type { AssetEntry, ProcessedAsset } from "../asset-tap/types";

class StubTarget extends AssetTarget<{ id: string }> {
    uploaded: ProcessedAsset[] = [];

    async shouldSync(_entry: AssetEntry): Promise<boolean> {
        return true;
    }

    async uploadAsset(asset: ProcessedAsset): Promise<void> {
        this.uploaded.push(asset);
    }
}

describe("AssetTarget", () => {
    it("complete() resolves without error by default", async () => {
        const target = new StubTarget({ id: "test" });
        await expect(target.complete()).resolves.toBeUndefined();
    });

    it("uploadAsset is abstract and must be implemented", async () => {
        const target = new StubTarget({ id: "test" });
        const asset: ProcessedAsset = {
            entry: { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: undefined, contentType: "image/jpeg" },
            downloadedPath: "out/tmp/a.jpg",
            uploadPath: "out/tmp/a.jpg",
            wasTransformed: false,
            size: 512,
            contentType: "image/jpeg",
        };
        await target.uploadAsset(asset);
        expect(target.uploaded).toHaveLength(1);
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-target/asset-target.test.ts
```

Expected: FAIL with "Cannot find module './asset-target'"

**Step 3: Write implementation**

```typescript
// src/sdk/models/asset-target/asset-target.ts
import type { AssetEntry, ProcessedAsset } from "../asset-tap/types";

export abstract class AssetTarget<C> {
    readonly config: C;

    constructor(config: C) {
        this.config = config;
    }

    /**
     * Called in INCREMENTAL mode to decide whether a file needs syncing.
     * Return true  → download, transform, and upload the file.
     * Return false → skip (file already up-to-date in destination).
     *
     * Typically compares entry.lastModified against the destination file's
     * last-modified timestamp (e.g. via a HEAD request).
     *
     * Not called in FULL mode — all files are always processed.
     */
    abstract shouldSync(entry: AssetEntry): Promise<boolean>;

    /**
     * Upload the processed (and possibly transformed) file to the destination.
     * Read from `asset.uploadPath`; use `asset.entry.destinationPath` as the
     * remote key.
     */
    abstract uploadAsset(asset: ProcessedAsset): Promise<void>;

    /**
     * Called after all streams have finished processing.
     * Override for any teardown work (e.g. flushing batch uploads).
     */
    async complete(): Promise<void> {}
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-target/asset-target.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/models/asset-target/asset-target.ts src/sdk/models/asset-target/asset-target.test.ts
git commit -m "feat: add AssetTarget abstract base class"
```

---

## Task 4: ImageMagickTransform helper

**Files:**
- Create: `src/sdk/models/asset-tap/image-magick-transform.ts`
- Create: `src/sdk/models/asset-tap/image-magick-transform.test.ts`

**Step 1: Write the failing test**

> Note: These tests use `vi.mock` to stub `child_process` — no ImageMagick binary required in CI.

```typescript
// src/sdk/models/asset-tap/image-magick-transform.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
    execFile: vi.fn(),
}));

import * as cp from "node:child_process";
import { ImageMagickTransform } from "./image-magick-transform";

describe("ImageMagickTransform.toWebp", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("calls magick mogrify with correct arguments and returns webp path", async () => {
        // Make execFile invoke its callback with success
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(null, "", "");
            return {} as any;
        });

        const inputPath = "out/tmp/logo.jpg";
        const result = await ImageMagickTransform.toWebp(inputPath, {
            width: 250,
            height: 250,
            background: "none",
            gravity: "center",
            extent: true,
        });

        // Output should be the same directory but .webp extension
        expect(result).toBe(path.join("out/tmp", "logo.webp"));

        // Verify the command was called
        expect(cp.execFile).toHaveBeenCalledOnce();
        const [cmd, args] = vi.mocked(cp.execFile).mock.calls[0]!;
        expect(cmd).toBe("magick");
        expect(args).toContain("mogrify");
        expect(args).toContain("-format");
        expect(args).toContain("webp");
        expect(args).toContain("-resize");
        expect(args).toContain("250x250");
        expect(args).toContain("-background");
        expect(args).toContain("none");
        expect(args).toContain("-gravity");
        expect(args).toContain("center");
        expect(args).toContain("-extent");
        expect(args).toContain(inputPath);
    });

    it("works without optional parameters", async () => {
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(null, "", "");
            return {} as any;
        });

        const result = await ImageMagickTransform.toWebp("out/tmp/img.png", {});
        expect(result).toBe(path.join("out/tmp", "img.webp"));

        const [, args] = vi.mocked(cp.execFile).mock.calls[0]!;
        expect(args).not.toContain("-resize");
        expect(args).not.toContain("-background");
        expect(args).not.toContain("-gravity");
        expect(args).not.toContain("-extent");
    });

    it("rejects when magick exits with an error", async () => {
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(new Error("magick not found"), "", "");
            return {} as any;
        });

        await expect(
            ImageMagickTransform.toWebp("out/tmp/logo.jpg", {})
        ).rejects.toThrow("magick not found");
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/image-magick-transform.test.ts
```

Expected: FAIL with "Cannot find module './image-magick-transform'"

**Step 3: Write implementation**

```typescript
// src/sdk/models/asset-tap/image-magick-transform.ts
import { execFile } from "node:child_process";
import path from "node:path";

export interface WebpOptions {
    /** Target width in pixels */
    width?: number;
    /** Target height in pixels */
    height?: number;
    /** Background color (e.g. "none", "white") */
    background?: string;
    /** Gravity for placement (e.g. "center") */
    gravity?: string;
    /** If true, extend canvas to exactly width×height */
    extent?: boolean;
}

export class ImageMagickTransform {
    /**
     * Converts an image to WebP format using `magick mogrify`.
     *
     * The output file is written to the same directory as the input,
     * with the extension replaced by `.webp`.
     *
     * Equivalent to:
     *   magick mogrify -format webp [-resize WxH] [-background <bg>]
     *                  [-gravity <g>] [-extent WxH] <inputPath>
     *
     * @param inputPath  Path to the source image file.
     * @param options    Optional resize / padding parameters.
     * @returns          Path to the produced `.webp` file.
     */
    static toWebp(inputPath: string, options: WebpOptions): Promise<string> {
        const dir = path.dirname(inputPath);
        const basename = path.basename(inputPath, path.extname(inputPath));
        const outputPath = path.join(dir, `${basename}.webp`);

        const args: string[] = ["mogrify", "-format", "webp"];

        if (options.width !== undefined && options.height !== undefined) {
            args.push("-resize", `${options.width}x${options.height}`);
        }
        if (options.background !== undefined) {
            args.push("-background", options.background);
        }
        if (options.gravity !== undefined) {
            args.push("-gravity", options.gravity);
        }
        if (options.extent === true && options.width !== undefined && options.height !== undefined) {
            args.push("-extent", `${options.width}x${options.height}`);
        }

        args.push(inputPath);

        return new Promise((resolve, reject) => {
            execFile("magick", args, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(outputPath);
                }
            });
        });
    }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/image-magick-transform.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/models/asset-tap/image-magick-transform.ts src/sdk/models/asset-tap/image-magick-transform.test.ts
git commit -m "feat: add ImageMagickTransform helper for webp conversion"
```

---

## Task 5: AssetTap orchestrator

**Files:**
- Create: `src/sdk/models/asset-tap/asset-tap.ts`
- Create: `src/sdk/models/asset-tap/asset-tap.test.ts`

**Step 1: Write the failing test**

```typescript
// src/sdk/models/asset-tap/asset-tap.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { AssetTap } from "./asset-tap";
import { AssetStream } from "./asset-stream";
import { AssetTarget } from "../asset-target/asset-target";
import type { AssetEntry, ProcessedAsset, AssetManifest } from "./types";

// ---- Stubs ----

class StubStream extends AssetStream<{}> {
    private items: AssetEntry[];
    constructor(id: string, items: AssetEntry[], mode: "FULL" | "INCREMENTAL" = "INCREMENTAL") {
        super(id, {}, mode);
        this.items = items;
    }
    async *listAssets() {
        for (const item of this.items) yield item;
    }
}

class StubTarget extends AssetTarget<{}> {
    uploaded: ProcessedAsset[] = [];
    private syncResult: boolean;

    constructor(syncResult = true) {
        super({});
        this.syncResult = syncResult;
    }
    async shouldSync(_entry: AssetEntry) { return this.syncResult; }
    async uploadAsset(asset: ProcessedAsset) { this.uploaded.push(asset); }
}

class StubTap extends AssetTap<{}> {
    private stubStreams: AssetStream<unknown>[];

    constructor(target: AssetTarget<unknown>, streams: AssetStream<unknown>[], outDir: string) {
        super(target, {}, outDir);
        this.stubStreams = streams;
    }

    async init() {
        for (const s of this.stubStreams) this.streams.push(s);
    }

    // Override download to write a fixture file instead of hitting a real source
    protected async downloadEntry(entry: AssetEntry, destPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, `content-of-${path.basename(entry.sourcePath)}`);
    }
}

// ---- Tests ----

describe("AssetTap", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "asset-tap-test-"));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    it("INCREMENTAL: uploads only entries where shouldSync returns true", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/b.jpg", destinationPath: "b.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries, "INCREMENTAL");
        const tap = new StubTap(target, [stream], tmpDir);

        const manifest = await tap.sync();

        expect(target.uploaded).toHaveLength(2);
        expect(manifest.summary.uploaded).toBe(2);
        expect(manifest.summary.skipped).toBe(0);
    });

    it("INCREMENTAL: skips entries where shouldSync returns false", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(false); // always skip
        const stream = new StubStream("images", entries, "INCREMENTAL");
        const tap = new StubTap(target, [stream], tmpDir);

        const manifest = await tap.sync();

        expect(target.uploaded).toHaveLength(0);
        expect(manifest.summary.skipped).toBe(1);
        expect(manifest.assets[0]?.status).toBe("skipped");
    });

    it("FULL: uploads all entries regardless of shouldSync", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/b.jpg", destinationPath: "b.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(false); // would skip in INCREMENTAL
        const stream = new StubStream("images", entries, "FULL");
        const tap = new StubTap(target, [stream], tmpDir);

        const manifest = await tap.sync();

        expect(target.uploaded).toHaveLength(2);
        expect(manifest.summary.uploaded).toBe(2);
    });

    it("writes manifest.json to outputDir", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: undefined, contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        const manifestPath = path.join(tmpDir, "manifest.json");
        expect(await fs.pathExists(manifestPath)).toBe(true);
        const manifest: AssetManifest = await fs.readJson(manifestPath);
        expect(manifest.assets).toHaveLength(1);
        expect(manifest.summary.total).toBe(1);
    });

    it("records per-file errors without aborting other files", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/b.jpg", destinationPath: "b.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];

        let callCount = 0;
        const target = new StubTarget(true);
        // Make first upload fail
        target.uploadAsset = async (asset) => {
            callCount++;
            if (callCount === 1) throw new Error("upload failed");
        };

        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);
        const manifest = await tap.sync();

        expect(manifest.summary.errors).toBe(1);
        expect(manifest.summary.uploaded).toBe(1);
        expect(manifest.assets.find(a => a.sourcePath === "/a.jpg")?.status).toBe("error");
        expect(manifest.assets.find(a => a.sourcePath === "/b.jpg")?.status).toBe("uploaded");
    });

    it("cleans up tmp files after upload", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/logo.jpg", destinationPath: "logo.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        // The tmp download file should be cleaned up
        const tmpFiles = await fs.readdir(path.join(tmpDir, "tmp")).catch(() => []);
        expect(tmpFiles).toHaveLength(0);
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/asset-tap.test.ts
```

Expected: FAIL with "Cannot find module './asset-tap'"

**Step 3: Write implementation**

```typescript
// src/sdk/models/asset-tap/asset-tap.ts
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../../service/logger";
import type { AssetTarget } from "../asset-target/asset-target";
import type { AssetStream } from "./asset-stream";
import type { AssetEntry, AssetManifest, AssetManifestEntry, ProcessedAsset } from "./types";

const logPrefix = "[AssetTap]";

export abstract class AssetTap<C> {
    readonly config: C;
    readonly outputDir: string;
    readonly streams: AssetStream<unknown>[] = [];

    private readonly target: AssetTarget<unknown>;

    constructor(target: AssetTarget<unknown>, config: C, outputDir = "out") {
        this.target = target;
        this.config = config;
        this.outputDir = outputDir;
    }

    /** Register streams. Called once at the start of sync(). */
    abstract init(): Promise<void>;

    /**
     * Download a single source entry to `destPath` on local disk.
     * Override this in concrete taps to pull from SFTP, API, etc.
     * The base class calls this method; tests can override it too.
     */
    protected abstract downloadEntry(entry: AssetEntry, destPath: string): Promise<void>;

    async sync(): Promise<AssetManifest> {
        await this.init();

        const tmpDir = path.join(this.outputDir, "tmp");
        await fs.ensureDir(tmpDir);

        const assetEntries: AssetManifestEntry[] = [];

        for (const stream of this.streams) {
            logger.info(`${logPrefix} Processing stream: ${stream.streamId} (mode=${stream.replicationMode})`);

            for await (const entry of stream.listAssets()) {
                logger.debug(`${logPrefix} Processing entry: ${entry.sourcePath}`);

                // INCREMENTAL: check if we need to sync this file
                if (stream.replicationMode === "INCREMENTAL") {
                    let shouldSync: boolean;
                    try {
                        shouldSync = await this.target.shouldSync(entry);
                    } catch (err) {
                        // shouldSync failure is stream-level (fatal): rethrow
                        throw err;
                    }

                    if (!shouldSync) {
                        logger.debug(`${logPrefix} Skipping ${entry.sourcePath} (up-to-date)`);
                        assetEntries.push({
                            sourcePath: entry.sourcePath,
                            destinationPath: entry.destinationPath,
                            localPath: "",
                            size: 0,
                            contentType: entry.contentType,
                            status: "skipped",
                            transformed: false,
                        });
                        continue;
                    }
                }

                // Download → transform → upload (per-file errors are non-fatal)
                const fileName = path.basename(entry.sourcePath);
                const downloadedPath = path.join(tmpDir, fileName);

                try {
                    await this.downloadEntry(entry, downloadedPath);

                    const uploadPath = await stream.transformFile(downloadedPath, entry);
                    const wasTransformed = uploadPath !== downloadedPath;

                    const stat = await fs.stat(uploadPath);
                    const processed: ProcessedAsset = {
                        entry,
                        downloadedPath,
                        uploadPath,
                        wasTransformed,
                        size: stat.size,
                        contentType: wasTransformed ? "image/webp" : entry.contentType,
                    };

                    await this.target.uploadAsset(processed);

                    assetEntries.push({
                        sourcePath: entry.sourcePath,
                        destinationPath: entry.destinationPath,
                        localPath: uploadPath,
                        size: processed.size,
                        contentType: processed.contentType,
                        status: "uploaded",
                        transformed: wasTransformed,
                    });

                    logger.info(`${logPrefix} Uploaded ${entry.sourcePath} → ${entry.destinationPath}`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    logger.error(`${logPrefix} Failed to process ${entry.sourcePath}: ${message}`);
                    assetEntries.push({
                        sourcePath: entry.sourcePath,
                        destinationPath: entry.destinationPath,
                        localPath: "",
                        size: 0,
                        contentType: entry.contentType,
                        status: "error",
                        transformed: false,
                        error: message,
                    });
                } finally {
                    // Clean up tmp files regardless of outcome
                    await fs.remove(downloadedPath).catch(() => undefined);
                    // If a different file was produced by transform, clean it up too
                    // (it was already uploaded at this point)
                }
            }
        }

        const summary = {
            total: assetEntries.length,
            uploaded: assetEntries.filter(a => a.status === "uploaded").length,
            skipped: assetEntries.filter(a => a.status === "skipped").length,
            errors: assetEntries.filter(a => a.status === "error").length,
        };

        const manifest: AssetManifest = {
            syncedAt: new Date().toISOString(),
            mode: this.streams[0]?.replicationMode ?? "INCREMENTAL",
            assets: assetEntries,
            summary,
        };

        await fs.ensureDir(this.outputDir);
        await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

        await this.target.complete();

        logger.info(`${logPrefix} Sync complete. Uploaded=${summary.uploaded} Skipped=${summary.skipped} Errors=${summary.errors}`);
        return manifest;
    }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/sdk/models/asset-tap/asset-tap.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/models/asset-tap/asset-tap.ts src/sdk/models/asset-tap/asset-tap.test.ts
git commit -m "feat: add AssetTap orchestrator with FULL/INCREMENTAL modes and manifest output"
```

---

## Task 6: CdnAssetTarget config

**Files:**
- Create: `src/targets/cdn/models/config.ts`

> No test needed — this is a pure type definition.

**Step 1: Write implementation**

```typescript
// src/targets/cdn/models/config.ts
import type { CdnServiceConfig } from "../../../services/cdn";

export interface CdnAssetTargetConfig extends CdnServiceConfig {
    /** The CDN ID (organization CDN identifier) */
    cdnId: string;
}
```

**Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/targets/cdn/models/config.ts
git commit -m "feat: add CdnAssetTargetConfig"
```

---

## Task 7: CdnAssetTarget concrete implementation

**Files:**
- Create: `src/targets/cdn/main.ts`
- Create: `src/targets/cdn/main.test.ts`

**Step 1: Write the failing test**

```typescript
// src/targets/cdn/main.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CdnAssetTarget } from "./main";
import { CdnService } from "../../services/cdn";
import type { AssetEntry, ProcessedAsset } from "../../sdk/models/asset-tap/types";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

// Mock CdnService
vi.mock("../../services/cdn", () => ({
    CdnService: vi.fn().mockImplementation(() => ({
        getFileMetadata: vi.fn(),
        uploadFile: vi.fn(),
    })),
}));

// Mock fs-extra readFile for uploadAsset
vi.mock("fs-extra", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs-extra")>();
    return {
        ...actual,
        readFile: vi.fn(),
    };
});

function makeEntry(overrides: Partial<AssetEntry> = {}): AssetEntry {
    return {
        sourcePath: "/remote/logo.jpg",
        destinationPath: "logos/logo.jpg",
        lastModified: new Date("2024-06-01T00:00:00Z"),
        contentType: "image/jpeg",
        ...overrides,
    };
}

function makeAsset(entry: AssetEntry): ProcessedAsset {
    return {
        entry,
        downloadedPath: "out/tmp/logo.jpg",
        uploadPath: "out/tmp/logo.jpg",
        wasTransformed: false,
        size: 1024,
        contentType: "image/jpeg",
    };
}

describe("CdnAssetTarget.shouldSync", () => {
    let target: CdnAssetTarget;
    let cdnService: { getFileMetadata: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        target = new CdnAssetTarget({ apiEndpoint: "https://api.whaly.io", serviceAccountKey: "sk:x", cdnId: "cdn-1" });
        cdnService = (CdnService as any).mock.results[0].value;
    });

    it("returns true when file does not exist in CDN", async () => {
        cdnService.getFileMetadata.mockResolvedValue({ exists: false, lastModified: null, contentType: null });
        const entry = makeEntry();
        expect(await target.shouldSync(entry)).toBe(true);
    });

    it("returns true when source is newer than CDN file", async () => {
        cdnService.getFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: new Date("2024-01-01T00:00:00Z"), // older
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: new Date("2024-06-01T00:00:00Z") }); // newer
        expect(await target.shouldSync(entry)).toBe(true);
    });

    it("returns false when CDN file is same age or newer", async () => {
        const date = new Date("2024-06-01T00:00:00Z");
        cdnService.getFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: date,
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: date });
        expect(await target.shouldSync(entry)).toBe(false);
    });

    it("returns true when source lastModified is undefined (cannot compare)", async () => {
        cdnService.getFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: new Date(),
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: undefined });
        expect(await target.shouldSync(entry)).toBe(true);
    });
});

describe("CdnAssetTarget.uploadAsset", () => {
    let target: CdnAssetTarget;
    let cdnService: { uploadFile: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        target = new CdnAssetTarget({ apiEndpoint: "https://api.whaly.io", serviceAccountKey: "sk:x", cdnId: "cdn-1" });
        cdnService = (CdnService as any).mock.results[0].value;
    });

    it("reads file from uploadPath and calls cdnService.uploadFile", async () => {
        const fileBuffer = Buffer.from("image-data");
        vi.mocked(fs.readFile).mockResolvedValue(fileBuffer as any);
        cdnService.uploadFile.mockResolvedValue({ filePath: "/org/cdn-1/file/logos/logo.jpg" });

        const entry = makeEntry();
        const asset = makeAsset(entry);
        await target.uploadAsset(asset);

        expect(fs.readFile).toHaveBeenCalledWith(asset.uploadPath);
        expect(cdnService.uploadFile).toHaveBeenCalledWith(
            "cdn-1",
            entry.destinationPath,
            fileBuffer
        );
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/targets/cdn/main.test.ts
```

Expected: FAIL with "Cannot find module './main'"

**Step 3: Write implementation**

```typescript
// src/targets/cdn/main.ts
import fs from "fs-extra";
import { CdnService } from "../../services/cdn";
import { logger } from "../../sdk/service/logger";
import { AssetTarget } from "../../sdk/models/asset-target/asset-target";
import type { AssetEntry, ProcessedAsset } from "../../sdk/models/asset-tap/types";
import type { CdnAssetTargetConfig } from "./models/config";

const logPrefix = "[CdnAssetTarget]";

export class CdnAssetTarget extends AssetTarget<CdnAssetTargetConfig> {
    private readonly cdnService: CdnService;

    constructor(config: CdnAssetTargetConfig) {
        super(config);
        this.cdnService = new CdnService({
            apiEndpoint: config.apiEndpoint,
            serviceAccountKey: config.serviceAccountKey,
        });
    }

    /**
     * Returns true when the file should be downloaded and uploaded.
     *
     * Logic:
     * - File doesn't exist in CDN → sync
     * - Source lastModified is undefined → always sync (cannot compare)
     * - Source lastModified > CDN lastModified → sync (source is newer)
     * - Source lastModified <= CDN lastModified → skip (CDN is up-to-date)
     */
    async shouldSync(entry: AssetEntry): Promise<boolean> {
        const metadata = await this.cdnService.getFileMetadata(this.config.cdnId, entry.destinationPath);

        if (!metadata.exists) {
            logger.debug(`${logPrefix} ${entry.destinationPath} not in CDN → will sync`);
            return true;
        }

        if (entry.lastModified === undefined) {
            logger.debug(`${logPrefix} ${entry.destinationPath} source has no lastModified → will sync`);
            return true;
        }

        if (metadata.lastModified === null) {
            logger.debug(`${logPrefix} ${entry.destinationPath} CDN has no lastModified → will sync`);
            return true;
        }

        const sourceIsNewer = entry.lastModified > metadata.lastModified;
        if (!sourceIsNewer) {
            logger.debug(`${logPrefix} Skipping ${entry.destinationPath} (CDN is up-to-date)`);
        }
        return sourceIsNewer;
    }

    /**
     * Reads the file from `asset.uploadPath` and uploads it to the CDN
     * at `asset.entry.destinationPath`.
     */
    async uploadAsset(asset: ProcessedAsset): Promise<void> {
        const fileBuffer = await fs.readFile(asset.uploadPath);
        await this.cdnService.uploadFile(
            this.config.cdnId,
            asset.entry.destinationPath,
            fileBuffer
        );
        logger.info(`${logPrefix} Uploaded ${asset.entry.destinationPath} (${fileBuffer.length} bytes)`);
    }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/targets/cdn/main.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/targets/cdn/main.ts src/targets/cdn/main.test.ts src/targets/cdn/models/config.ts
git commit -m "feat: add CdnAssetTarget concrete implementation"
```

---

## Task 8: Wire exports in src/index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add exports**

Add the following block after the existing `/** Services */` block in `src/index.ts`:

```typescript
/**
 * Asset Tap / Target (file-level pipeline)
 */
export * from "./sdk/models/asset-tap/types";
export * from "./sdk/models/asset-tap/asset-stream";
export * from "./sdk/models/asset-tap/asset-tap";
export * from "./sdk/models/asset-tap/image-magick-transform";
export * from "./sdk/models/asset-target/asset-target";
export * from "./targets/cdn/main";
export * from "./targets/cdn/models/config";
```

**Step 2: Typecheck to verify no export conflicts**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Run all tests to make sure nothing is broken**

```bash
npm test
```

Expected: all tests PASS

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export asset tap/target classes from public API"
```

---

## Task 9: Full test run + typecheck

**Step 1: Run all tests**

```bash
npm test
```

Expected: all tests PASS, no failures

**Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Build**

```bash
npm run build
```

Expected: builds successfully with CJS + ESM + types output

**Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore: final fixups for asset tap/target protocol"
```

Only commit if there were actual changes needed.

---

## Summary of Files Created

| File | Purpose |
|------|---------|
| `src/sdk/models/asset-tap/types.ts` | Core types: AssetEntry, ProcessedAsset, AssetManifest |
| `src/sdk/models/asset-tap/asset-stream.ts` | Abstract AssetStream base class |
| `src/sdk/models/asset-tap/asset-tap.ts` | Abstract AssetTap orchestrator |
| `src/sdk/models/asset-tap/image-magick-transform.ts` | ImageMagick shell helper |
| `src/sdk/models/asset-target/asset-target.ts` | Abstract AssetTarget base class |
| `src/targets/cdn/models/config.ts` | CdnAssetTargetConfig type |
| `src/targets/cdn/main.ts` | CdnAssetTarget concrete implementation |
| `src/index.ts` | +7 export lines |

## Usage Example (for implementors of concrete taps)

```typescript
// my-sftp-image-tap.ts
import { AssetTap, AssetStream, CdnAssetTarget, ImageMagickTransform } from "@whaly/connector-sdk";
import type { AssetEntry } from "@whaly/connector-sdk";
import SftpClient from "ssh2-sftp-client";

class SftpImageStream extends AssetStream<{ remotePath: string }> {
    private sftp = new SftpClient();

    async *listAssets(): AsyncIterable<AssetEntry> {
        const list = await this.sftp.list(this.config.remotePath);
        for (const item of list) {
            yield {
                sourcePath: `${this.config.remotePath}/${item.name}`,
                destinationPath: `images/${item.name.replace(/\.\w+$/, ".webp")}`,
                lastModified: item.modifyTime ? new Date(item.modifyTime) : undefined,
                contentType: "image/jpeg",
            };
        }
    }

    async transformFile(downloadedPath: string, entry: AssetEntry): Promise<string> {
        return ImageMagickTransform.toWebp(downloadedPath, {
            width: 250, height: 250,
            background: "none", gravity: "center", extent: true,
        });
    }
}

class MyImageTap extends AssetTap<{ sftpHost: string }> {
    async init() {
        this.streams.push(new SftpImageStream("products", { remotePath: "/images/products" }, "INCREMENTAL"));
    }

    protected async downloadEntry(entry: AssetEntry, destPath: string) {
        // pull file from SFTP to destPath
    }
}

// Run it
const target = new CdnAssetTarget({ apiEndpoint: "...", serviceAccountKey: "sk:...", cdnId: "my-cdn" });
const tap = new MyImageTap(target, { sftpHost: "..." }, "out");
const manifest = await tap.sync();
console.log(manifest.summary);
// Inspect out/manifest.json for full details
```
