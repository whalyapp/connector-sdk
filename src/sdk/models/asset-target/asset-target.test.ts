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
