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

    /**
     * Download a single source entry to `destPath` on local disk.
     * Override this in concrete streams to pull from SFTP, API, etc.
     */
    abstract downloadEntry(entry: AssetEntry, destPath: string): Promise<void>;

    async transformFile(downloadedPath: string, _entry: AssetEntry): Promise<string> {
        return downloadedPath;
    }
}
