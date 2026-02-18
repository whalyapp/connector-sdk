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

    abstract listAssets(): AsyncIterable<AssetEntry>;

    async transformFile(downloadedPath: string, _entry: AssetEntry): Promise<string> {
        return downloadedPath;
    }
}
