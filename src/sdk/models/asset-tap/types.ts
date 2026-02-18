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
