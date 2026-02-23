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

    async downloadEntry(entry: AssetEntry, destPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, `content-of-${path.basename(entry.sourcePath)}`);
    }
}

class TransformingStream extends AssetStream<{}> {
    private items: AssetEntry[];
    constructor(id: string, items: AssetEntry[]) {
        super(id, {}, "INCREMENTAL");
        this.items = items;
    }
    async *listAssets() {
        for (const item of this.items) yield item;
    }

    async downloadEntry(entry: AssetEntry, destPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, `content-of-${path.basename(entry.sourcePath)}`);
    }
    async transformFile(downloadedPath: string, _entry: AssetEntry): Promise<string> {
        // Simulate creating a .webp file next to the downloaded file
        const dir = path.dirname(downloadedPath);
        const basename = path.basename(downloadedPath, path.extname(downloadedPath));
        const webpPath = path.join(dir, `${basename}.webp`);
        await fs.writeFile(webpPath, "fake-webp-content");
        return webpPath;
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

    constructor(target: AssetTarget<unknown>, streams: AssetStream<unknown>[], outDir: string, concurrency?: number) {
        super(target, {}, outDir, concurrency);
        this.stubStreams = streams;
    }

    async init() {
        for (const s of this.stubStreams) this.streams.push(s);
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
        expect(manifest.streams[0]?.assets[0]?.status).toBe("skipped");
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
        expect(manifest.streams[0]?.assets).toHaveLength(1);
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
        const assets = manifest.streams[0]?.assets ?? [];
        expect(assets.find(a => a.sourcePath === "/a.jpg")?.status).toBe("error");
        expect(assets.find(a => a.sourcePath === "/b.jpg")?.status).toBe("uploaded");
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

    // Fix #1: entries with same basename from different dirs don't collide
    it("handles entries with duplicate basenames from different directories", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/dir1/logo.jpg", destinationPath: "dir1/logo.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            { sourcePath: "/dir2/logo.jpg", destinationPath: "dir2/logo.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        const manifest = await tap.sync();

        // Both should upload successfully (no overwrite)
        expect(target.uploaded).toHaveLength(2);
        expect(manifest.summary.uploaded).toBe(2);
        expect(manifest.summary.errors).toBe(0);
        // Verify the content is different (proves no overwrite happened)
        const firstContent = await fs.readFile(target.uploaded[0]!.uploadPath, "utf-8").catch(() => null);
        // Files are cleaned up after upload, so we check via the uploaded assets' entries
        expect(target.uploaded[0]!.entry.sourcePath).toBe("/dir1/logo.jpg");
        expect(target.uploaded[1]!.entry.sourcePath).toBe("/dir2/logo.jpg");
    });

    // Fix #2: transformed files infer contentType from extension, not hardcoded
    it("infers contentType from file extension after transform", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/logo.jpg", destinationPath: "logo.webp", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new TransformingStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        expect(target.uploaded).toHaveLength(1);
        expect(target.uploaded[0]!.contentType).toBe("image/webp");
        expect(target.uploaded[0]!.wasTransformed).toBe(true);
    });

    // Fix #3: transformed (uploadPath) files are also cleaned up
    it("cleans up both downloaded and transformed files after upload", async () => {
        const entries: AssetEntry[] = [
            { sourcePath: "/logo.jpg", destinationPath: "logo.webp", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(true);
        const stream = new TransformingStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir);

        await tap.sync();

        // Both the original download AND the transformed file should be cleaned up
        const tmpFiles = await fs.readdir(path.join(tmpDir, "tmp")).catch(() => []);
        expect(tmpFiles).toHaveLength(0);
    });

    // Fix #4: multiple streams with different modes
    it("processes multiple streams with different replication modes", async () => {
        const fullEntries: AssetEntry[] = [
            { sourcePath: "/full.jpg", destinationPath: "full.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const incrEntries: AssetEntry[] = [
            { sourcePath: "/incr.jpg", destinationPath: "incr.jpg", lastModified: new Date(), contentType: "image/jpeg" },
        ];
        const target = new StubTarget(false); // shouldSync returns false
        const fullStream = new StubStream("full-stream", fullEntries, "FULL");
        const incrStream = new StubStream("incr-stream", incrEntries, "INCREMENTAL");
        const tap = new StubTap(target, [fullStream, incrStream], tmpDir);

        const manifest = await tap.sync();

        // FULL stream uploads regardless, INCREMENTAL stream skips
        expect(manifest.summary.uploaded).toBe(1);
        expect(manifest.summary.skipped).toBe(1);
        const allAssets = manifest.streams.flatMap(s => s.assets);
        expect(allAssets.find(a => a.sourcePath === "/full.jpg")?.status).toBe("uploaded");
        expect(allAssets.find(a => a.sourcePath === "/incr.jpg")?.status).toBe("skipped");
        // Mixed modes → manifest reports FULL
        expect(manifest.mode).toBe("FULL");
    });

    it("processes assets concurrently up to the concurrency limit", async () => {
        const entries: AssetEntry[] = Array.from({ length: 6 }, (_, i) => ({
            sourcePath: `/${i}.jpg`,
            destinationPath: `${i}.jpg`,
            lastModified: new Date(),
            contentType: "image/jpeg",
        }));

        let active = 0;
        let maxActive = 0;
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const originalDownload = stream.downloadEntry.bind(stream);
        stream.downloadEntry = async (entry: AssetEntry, destPath: string) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 50));
            await originalDownload(entry, destPath);
            active--;
        };

        const tap = new StubTap(target, [stream], tmpDir, 3);
        const manifest = await tap.sync();

        expect(manifest.summary.uploaded).toBe(6);
        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(3);
    });

    it("concurrency=1 processes assets sequentially", async () => {
        const entries: AssetEntry[] = Array.from({ length: 3 }, (_, i) => ({
            sourcePath: `/${i}.jpg`,
            destinationPath: `${i}.jpg`,
            lastModified: new Date(),
            contentType: "image/jpeg",
        }));

        let active = 0;
        let maxActive = 0;
        const target = new StubTarget(true);
        const stream = new StubStream("images", entries);
        const originalDownload = stream.downloadEntry.bind(stream);
        stream.downloadEntry = async (entry: AssetEntry, destPath: string) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 20));
            await originalDownload(entry, destPath);
            active--;
        };

        const tap = new StubTap(target, [stream], tmpDir, 1);
        const manifest = await tap.sync();

        expect(manifest.summary.uploaded).toBe(3);
        expect(maxActive).toBe(1);
    });

    it("concurrent processing still isolates per-asset errors", async () => {
        const entries: AssetEntry[] = Array.from({ length: 4 }, (_, i) => ({
            sourcePath: `/${i}.jpg`,
            destinationPath: `${i}.jpg`,
            lastModified: new Date(),
            contentType: "image/jpeg",
        }));

        const target = new StubTarget(true);
        let uploadCount = 0;
        target.uploadAsset = async (_asset) => {
            uploadCount++;
            if (uploadCount === 2) throw new Error("upload failed");
        };

        const stream = new StubStream("images", entries);
        const tap = new StubTap(target, [stream], tmpDir, 2);
        const manifest = await tap.sync();

        expect(manifest.summary.errors).toBe(1);
        expect(manifest.summary.uploaded).toBe(3);
    });

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

        it("cleans out/ directory from previous runs before starting", async () => {
            // Pre-populate with stale files from a "previous run"
            const staleDir = path.join(tmpDir, "old-stream");
            await fs.ensureDir(staleDir);
            await fs.writeFile(path.join(staleDir, "stale.jpg"), "old-content");
            await fs.writeFile(path.join(tmpDir, "manifest.json"), "{}");

            const entries: AssetEntry[] = [
                { sourcePath: "/a.jpg", destinationPath: "a.jpg", lastModified: new Date(), contentType: "image/jpeg" },
            ];
            const target = new StubTarget(true);
            const stream = new StubStream("images", entries);
            const tap = new StubTap(target, [stream], tmpDir);

            await tap.sync();

            // Stale directory should be gone
            expect(await fs.pathExists(staleDir)).toBe(false);
            // New outputs should exist
            expect(await fs.pathExists(path.join(tmpDir, "manifest.json"))).toBe(true);
            expect(await fs.pathExists(path.join(tmpDir, "images", "a.jpg"))).toBe(true);
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
});
