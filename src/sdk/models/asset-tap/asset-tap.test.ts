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
