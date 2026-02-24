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
