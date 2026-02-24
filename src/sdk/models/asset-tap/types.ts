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
    /** Path in the downloaded/ folder */
    downloadedPath: string;
    /** Path in the transformed/ folder (empty string if not transformed) */
    transformedPath: string;
    size: number;
    contentType: string;
    status: "uploaded" | "skipped" | "error";
    transformed: boolean;
    error?: string;
}

export interface StreamManifest {
    streamId: string;
    mode: AssetReplicationMode;
    syncedAt: string;
    assets: AssetManifestEntry[];
    summary: { total: number; uploaded: number; skipped: number; errors: number };
}

export interface AssetManifest {
    /** ISO 8601 timestamp of when the sync completed */
    syncedAt: string;
    mode: AssetReplicationMode;
    streams: StreamManifest[];
    summary: {
        total: number;
        uploaded: number;
        skipped: number;
        errors: number;
    };
}
