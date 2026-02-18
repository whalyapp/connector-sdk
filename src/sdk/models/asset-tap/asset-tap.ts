import fs from "fs-extra";
import path from "node:path";
import { logger } from "../../service/logger";
import type { AssetTarget } from "../asset-target/asset-target";
import type { AssetStream } from "./asset-stream";
import type { AssetEntry, AssetManifest, AssetManifestEntry, ProcessedAsset } from "./types";

const logPrefix = "[AssetTap]";

export abstract class AssetTap<C> {
    readonly config: C;
    readonly outputDir: string;
    readonly streams: AssetStream<unknown>[] = [];

    private readonly target: AssetTarget<unknown>;

    constructor(target: AssetTarget<unknown>, config: C, outputDir = "out") {
        this.target = target;
        this.config = config;
        this.outputDir = outputDir;
    }

    /** Register streams. Called once at the start of sync(). */
    abstract init(): Promise<void>;

    /**
     * Download a single source entry to `destPath` on local disk.
     * Override this in concrete taps to pull from SFTP, API, etc.
     */
    protected abstract downloadEntry(entry: AssetEntry, destPath: string): Promise<void>;

    async sync(): Promise<AssetManifest> {
        await this.init();

        const tmpDir = path.join(this.outputDir, "tmp");
        await fs.ensureDir(tmpDir);

        const assetEntries: AssetManifestEntry[] = [];

        for (const stream of this.streams) {
            logger.info(`${logPrefix} Processing stream: ${stream.streamId} (mode=${stream.replicationMode})`);

            for await (const entry of stream.listAssets()) {
                logger.debug(`${logPrefix} Processing entry: ${entry.sourcePath}`);

                // INCREMENTAL: check if we need to sync this file
                if (stream.replicationMode === "INCREMENTAL") {
                    const shouldSync = await this.target.shouldSync(entry);

                    if (!shouldSync) {
                        logger.debug(`${logPrefix} Skipping ${entry.sourcePath} (up-to-date)`);
                        assetEntries.push({
                            sourcePath: entry.sourcePath,
                            destinationPath: entry.destinationPath,
                            localPath: "",
                            size: 0,
                            contentType: entry.contentType,
                            status: "skipped",
                            transformed: false,
                        });
                        continue;
                    }
                }

                const fileName = path.basename(entry.sourcePath);
                const downloadedPath = path.join(tmpDir, fileName);

                try {
                    await this.downloadEntry(entry, downloadedPath);

                    const uploadPath = await stream.transformFile(downloadedPath, entry);
                    const wasTransformed = uploadPath !== downloadedPath;

                    const stat = await fs.stat(uploadPath);
                    const processed: ProcessedAsset = {
                        entry,
                        downloadedPath,
                        uploadPath,
                        wasTransformed,
                        size: stat.size,
                        contentType: wasTransformed ? "image/webp" : entry.contentType,
                    };

                    await this.target.uploadAsset(processed);

                    assetEntries.push({
                        sourcePath: entry.sourcePath,
                        destinationPath: entry.destinationPath,
                        localPath: uploadPath,
                        size: processed.size,
                        contentType: processed.contentType,
                        status: "uploaded",
                        transformed: wasTransformed,
                    });

                    logger.info(`${logPrefix} Uploaded ${entry.sourcePath} → ${entry.destinationPath}`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    logger.error(`${logPrefix} Failed to process ${entry.sourcePath}: ${message}`);
                    assetEntries.push({
                        sourcePath: entry.sourcePath,
                        destinationPath: entry.destinationPath,
                        localPath: "",
                        size: 0,
                        contentType: entry.contentType,
                        status: "error",
                        transformed: false,
                        error: message,
                    });
                } finally {
                    await fs.remove(downloadedPath).catch(() => undefined);
                }
            }
        }

        const summary = {
            total: assetEntries.length,
            uploaded: assetEntries.filter(a => a.status === "uploaded").length,
            skipped: assetEntries.filter(a => a.status === "skipped").length,
            errors: assetEntries.filter(a => a.status === "error").length,
        };

        const manifest: AssetManifest = {
            syncedAt: new Date().toISOString(),
            mode: this.streams[0]?.replicationMode ?? "INCREMENTAL",
            assets: assetEntries,
            summary,
        };

        await fs.ensureDir(this.outputDir);
        await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

        await this.target.complete();

        logger.info(`${logPrefix} Sync complete. Uploaded=${summary.uploaded} Skipped=${summary.skipped} Errors=${summary.errors}`);
        return manifest;
    }
}
