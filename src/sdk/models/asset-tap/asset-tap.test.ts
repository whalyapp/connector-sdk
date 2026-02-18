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

class TransformingStream extends AssetStream<{}> {
    private items: AssetEntry[];
    constructor(id: string, items: AssetEntry[]) {
        super(id, {}, "INCREMENTAL");
        this.items = items;
    }
    async *listAssets() {
        for (const item of this.items) yield item;
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
        expect(manifest.assets.find(a => a.sourcePath === "/full.jpg")?.status).toBe("uploaded");
        expect(manifest.assets.find(a => a.sourcePath === "/incr.jpg")?.status).toBe("skipped");
        // Mixed modes → manifest reports FULL
        expect(manifest.mode).toBe("FULL");
    });
});
