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
