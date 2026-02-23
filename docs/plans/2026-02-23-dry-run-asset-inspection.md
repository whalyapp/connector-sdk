# DRY_RUN Asset Inspection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In DRY_RUN mode, copy transformed files to `out/<streamId>/` for inspection and stop after `DRY_RUN_LIMIT` assets per stream.

**Architecture:** Two small changes to `AssetTap.sync()` in the SDK, plus a new `getDryRunLimit()` helper. File copying happens in the `try` block right after transform. The per-stream limit counter increments after each asset attempt and breaks the loop when reached.

**Tech Stack:** TypeScript, fs-extra, vitest

---

### Task 1: Add `getDryRunLimit()` to `dryRun.ts`

**Files:**
- Modify: `src/sdk/service/dryRun.ts`

**Step 1: Write the failing test**

In `src/sdk/service/dryRun.ts` there are no tests yet — we'll inline the test for the helper in a new sibling test file.

Create `src/sdk/service/dryRun.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { getDryRunLimit } from "./dryRun";

describe("getDryRunLimit", () => {
    afterEach(() => { delete process.env["DRY_RUN_LIMIT"]; });

    it("returns undefined when DRY_RUN_LIMIT is not set", () => {
        expect(getDryRunLimit()).toBeUndefined();
    });

    it("returns the parsed number when DRY_RUN_LIMIT is a positive integer", () => {
        process.env["DRY_RUN_LIMIT"] = "5";
        expect(getDryRunLimit()).toBe(5);
    });

    it("returns undefined when DRY_RUN_LIMIT is 0", () => {
        process.env["DRY_RUN_LIMIT"] = "0";
        expect(getDryRunLimit()).toBeUndefined();
    });

    it("returns undefined when DRY_RUN_LIMIT is not a number", () => {
        process.env["DRY_RUN_LIMIT"] = "abc";
        expect(getDryRunLimit()).toBeUndefined();
    });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm test -- src/sdk/service/dryRun.test.ts
```

Expected: FAIL — `getDryRunLimit is not a function`

**Step 3: Add `getDryRunLimit` to `dryRun.ts`**

```typescript
export function isDryRun(): boolean {
    const val = process.env["DRY_RUN"];
    return val !== undefined && val !== "" && val !== "0" && val !== "false";
}

export function getDryRunLimit(): number | undefined {
    const val = process.env["DRY_RUN_LIMIT"];
    if (!val) return undefined;
    const n = parseInt(val, 10);
    return isNaN(n) || n <= 0 ? undefined : n;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm test -- src/sdk/service/dryRun.test.ts
```

Expected: PASS — 4 tests passing

**Step 5: Commit**

```bash
cd /home/pdepoulpiquet/code/connector-sdk
git add src/sdk/service/dryRun.ts src/sdk/service/dryRun.test.ts
git commit -m "feat: add getDryRunLimit helper to dryRun service"
```

---

### Task 2: Add DRY_RUN tests to `asset-tap.test.ts`

**Files:**
- Modify: `src/sdk/models/asset-tap/asset-tap.test.ts`

The existing test file already has `StubStream`, `TransformingStream`, `StubTarget`, and `StubTap` stubs. Add a new `describe("DRY_RUN mode", ...)` block at the end of the file, before the closing `});` of the outer `describe`.

**Step 1: Add the failing tests**

Append this block inside the outer `describe("AssetTap", ...)`:

```typescript
describe("DRY_RUN mode", () => {
    beforeEach(() => { process.env["DRY_RUN"] = "true"; });
    afterEach(() => {
        delete process.env["DRY_RUN"];
        delete process.env["DRY_RUN_LIMIT"];
    });

    it("does not call uploadAsset or target.complete", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const completeSpy = vi.spyOn(target, "complete" as any);
        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        expect(target.uploaded).toHaveLength(0);
        expect(completeSpy).not.toHaveBeenCalled();
    });

    it("copies transformed file to out/<streamId>/<destinationPath>", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/logo.jpg", destinationPath: "logo.webp", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new TransformingStream("my-stream", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        const inspectPath = path.join(tmpDir, "my-stream", "logo.webp");
        expect(await fs.pathExists(inspectPath)).toBe(true);
        expect(await fs.readFile(inspectPath, "utf-8")).toBe("fake-webp-content");
    });

    it("still cleans up tmp files after dry-run processing", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/logo.jpg", destinationPath: "logo.webp", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new TransformingStream("my-stream", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        const tmpFiles = await fs.readdir(path.join(tmpDir, "tmp")).catch(() => []);
        expect(tmpFiles).toHaveLength(0);
    });

    it("DRY_RUN_LIMIT stops after N assets per stream", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/b.jpg", destinationPath: "b.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/c.jpg", destinationPath: "c.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        process.env["DRY_RUN_LIMIT"] = "2";
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        const manifest = await tap.sync();

        expect(manifest.summary.total).toBe(2);
    });

    it("DRY_RUN_LIMIT applies independently per stream", async () => {
        const makeEntries = (prefix: string): AssetEntry[] => [
            { sourcePath: `/${prefix}-a.jpg`, destinationPath: `${prefix}-a.jpg`, lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: `/${prefix}-b.jpg`, destinationPath: `${prefix}-b.jpg`, lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: `/${prefix}-c.jpg`, destinationPath: `${prefix}-c.jpg`, lastModified: new Date(), contentType: "image/jpeg" },
        ];
        process.env["DRY_RUN_LIMIT"] = "2";
        const target = new StubTarget(true);
        const stream1 = new StubStream("stream-1", makeEntries("s1"));
        const stream2 = new StubStream("stream-2", makeEntries("s2"));
        const tap = new StubTap(target, [stream1, stream2], tmpDir);

        const manifest = await tap.sync();

        // 2 per stream = 4 total
        expect(manifest.summary.total).toBe(4);
        expect(manifest.streams[0]?.assets).toHaveLength(2);
        expect(manifest.streams[1]?.assets).toHaveLength(2);
    });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm test -- src/sdk/models/asset-tap/asset-tap.test.ts
```

Expected: the new DRY_RUN tests FAIL (no inspection copy, no limit logic yet). Existing tests still PASS.

**Step 3: Commit the failing tests**

```bash
cd /home/pdepoulpiquet/code/connector-sdk
git add src/sdk/models/asset-tap/asset-tap.test.ts
git commit -m "test: add failing tests for DRY_RUN file inspection and per-stream limit"
```

---

### Task 3: Implement DRY_RUN inspection and limit in `asset-tap.ts`

**Files:**
- Modify: `src/sdk/models/asset-tap/asset-tap.ts`

**Step 1: Import `getDryRunLimit` at the top**

Add to the existing import from `dryRun`:

```typescript
import { isDryRun, getDryRunLimit } from "../../service/dryRun";
```

**Step 2: Add limit + per-stream counter + file copy**

Replace the inner loop in `sync()` (the `for (const stream of this.streams)` block). The full updated `sync()` method:

```typescript
async sync(): Promise<AssetManifest> {
    await this.init();

    const tmpDir = path.join(this.outputDir, "tmp");
    await fs.ensureDir(tmpDir);

    const dryRun = isDryRun();
    const dryRunLimit = dryRun ? getDryRunLimit() : undefined;
    if (dryRun) {
        logger.info(`${logPrefix} [DRY_RUN] mode active — skipping CDN checks and uploads`);
        if (dryRunLimit !== undefined) {
            logger.info(`${logPrefix} [DRY_RUN] Limit: ${dryRunLimit} assets per stream`);
        }
    }

    const streamManifests: StreamManifest[] = [];
    let entryIndex = 0;
    let totalSummary = { total: 0, uploaded: 0, skipped: 0, errors: 0 };

    for (const stream of this.streams) {
        logger.info(`${logPrefix} Processing stream: ${stream.streamId} (mode=${stream.replicationMode})`);

        const assetEntries: AssetManifestEntry[] = [];
        let streamAssetCount = 0;

        for await (const entry of stream.listAssets()) {
            logger.debug(`${logPrefix} Processing entry: ${entry.sourcePath}`);

            // INCREMENTAL: check if we need to sync this file (skip CDN check in DRY_RUN)
            if (stream.replicationMode === "INCREMENTAL" && !dryRun) {
                const shouldSync = await this.target.shouldSync(entry);

                if (!shouldSync) {
                    logger.debug(`${logPrefix} Skipping ${entry.sourcePath} (up-to-date)`);
                    assetEntries.push({
                        sourcePath: entry.sourcePath,
                        destinationPath: entry.destinationPath,
                        downloadedPath: "",
                        transformedPath: "",
                        size: 0,
                        contentType: entry.contentType,
                        status: "skipped",
                        transformed: false,
                    });
                    continue;
                }
            }

            // Use counter prefix to avoid basename collisions
            // (e.g. /dir1/logo.jpg and /dir2/logo.jpg both have basename "logo.jpg")
            const fileName = `${entryIndex}_${path.basename(entry.sourcePath)}`;
            const downloadedPath = path.join(tmpDir, fileName);
            let uploadPath = downloadedPath;
            entryIndex++;
            streamAssetCount++;

            try {
                await stream.downloadEntry(entry, downloadedPath);

                uploadPath = await stream.transformFile(downloadedPath, entry);
                const wasTransformed = uploadPath !== downloadedPath;

                const stat = await fs.stat(uploadPath);
                const processed: ProcessedAsset = {
                    entry,
                    downloadedPath,
                    uploadPath,
                    wasTransformed,
                    size: stat.size,
                    contentType: wasTransformed
                        ? inferContentType(uploadPath, entry.contentType)
                        : entry.contentType,
                };

                if (!dryRun) {
                    await this.target.uploadAsset(processed);
                } else {
                    // Copy the transformed file to out/<streamId>/<destinationPath> for inspection
                    const inspectPath = path.join(this.outputDir, stream.streamId, entry.destinationPath);
                    await fs.ensureDir(path.dirname(inspectPath));
                    await fs.copy(uploadPath, inspectPath);
                }

                assetEntries.push({
                    sourcePath: entry.sourcePath,
                    destinationPath: entry.destinationPath,
                    downloadedPath,
                    transformedPath: wasTransformed ? uploadPath : "",
                    size: processed.size,
                    contentType: processed.contentType,
                    status: "uploaded",
                    transformed: wasTransformed,
                });

                logger.info(`${logPrefix} ${dryRun ? "[DRY_RUN] Processed" : "Uploaded"} ${entry.sourcePath} → ${entry.destinationPath}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error(`${logPrefix} Failed to process ${entry.sourcePath}: ${message}`);
                assetEntries.push({
                    sourcePath: entry.sourcePath,
                    destinationPath: entry.destinationPath,
                    downloadedPath: "",
                    transformedPath: "",
                    size: 0,
                    contentType: entry.contentType,
                    status: "error",
                    transformed: false,
                    error: message,
                });
            } finally {
                // Clean up downloaded file
                await fs.remove(downloadedPath).catch(() => undefined);
                // If transform produced a different file, clean that up too
                if (uploadPath !== downloadedPath) {
                    await fs.remove(uploadPath).catch(() => undefined);
                }
            }

            if (dryRunLimit !== undefined && streamAssetCount >= dryRunLimit) {
                logger.info(`${logPrefix} [DRY_RUN] Reached limit of ${dryRunLimit} for stream "${stream.streamId}", stopping.`);
                break;
            }
        }

        const streamSummary = {
            total: assetEntries.length,
            uploaded: assetEntries.filter(a => a.status === "uploaded").length,
            skipped: assetEntries.filter(a => a.status === "skipped").length,
            errors: assetEntries.filter(a => a.status === "error").length,
        };

        totalSummary.total += streamSummary.total;
        totalSummary.uploaded += streamSummary.uploaded;
        totalSummary.skipped += streamSummary.skipped;
        totalSummary.errors += streamSummary.errors;

        streamManifests.push({
            streamId: stream.streamId,
            mode: stream.replicationMode,
            syncedAt: new Date().toISOString(),
            assets: assetEntries,
            summary: streamSummary,
        });
    }

    const manifest: AssetManifest = {
        syncedAt: new Date().toISOString(),
        mode: deriveManifestMode(this.streams),
        streams: streamManifests,
        summary: totalSummary,
    };

    await fs.ensureDir(this.outputDir);
    await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

    if (!dryRun) {
        await this.target.complete();
    }

    logger.info(`${logPrefix} Sync complete. Uploaded=${totalSummary.uploaded} Skipped=${totalSummary.skipped} Errors=${totalSummary.errors}`);
    return manifest;
}
```

**Step 3: Run tests to verify they pass**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm test -- src/sdk/models/asset-tap/asset-tap.test.ts
```

Expected: ALL tests pass (existing + new DRY_RUN tests)

**Step 4: Run full test suite**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm test
```

Expected: all tests pass, no regressions

**Step 5: Commit**

```bash
cd /home/pdepoulpiquet/code/connector-sdk
git add src/sdk/models/asset-tap/asset-tap.ts
git commit -m "feat: DRY_RUN writes inspection files to out/<streamId>/ and respects DRY_RUN_LIMIT"
```

---

### Task 4: Rebuild SDK and verify in sfdc-image-sync

**Files:**
- No code changes — rebuild and manual smoke test only

**Step 1: Rebuild the SDK**

```bash
cd /home/pdepoulpiquet/code/connector-sdk && npm run build
```

Expected: `dist/` updated, no TypeScript errors

**Step 2: Reinstall in the connector**

```bash
cd /home/pdepoulpiquet/code/client_projects/22694_danone/sfdc-image-sync && npm install
```

**Step 3: Run dry-run with a limit**

```bash
cd /home/pdepoulpiquet/code/client_projects/22694_danone/sfdc-image-sync
set -a && source .env && set +a && DRY_RUN=true DRY_RUN_LIMIT=3 npm run start 2>&1
```

Expected:
- Logs show `[DRY_RUN] Limit: 3 assets per stream`
- At most 3 `[DRY_RUN] Processed` lines per workspace stream
- Process completes quickly

**Step 4: Inspect output**

```bash
ls -R out/
```

Expected:
```
out/
  ai-product-photos/
    <ean>.webp   (up to 3 files)
  bsa-product-photos/
    <ean>.webp   (up to 3 files)
  ...
  manifest.json
```

Open a few `.webp` files to confirm they are valid, properly sized images.
