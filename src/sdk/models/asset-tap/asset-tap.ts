import fs from "fs-extra";
import path from "node:path";
import { logger } from "../../service/logger";
import { getMimeType, getExtension } from "../../service/mime";
import { processFromAsyncIterable } from "../../service/concurrency";
import type { AssetTarget } from "../asset-target/asset-target";
import type { AssetStream } from "./asset-stream";
import type { AssetEntry, AssetManifest, AssetManifestEntry, AssetReplicationMode, ProcessedAsset, StreamManifest } from "./types";
import { isDryRun, getDryRunLimit } from "../../service/dryRun";

const logPrefix = "[AssetTap]";

function inferContentType(filePath: string, fallback: string): string {
    const mime = getMimeType(filePath);
    return mime !== "application/octet-stream" ? mime : fallback;
}

function deriveManifestMode(streams: AssetStream<unknown>[]): AssetReplicationMode {
    const modes = new Set(streams.map(s => s.replicationMode));
    if (modes.size > 1) {
        logger.warn(`${logPrefix} Streams have mixed replication modes (${[...modes].join(", ")}). Manifest will report "FULL".`);
        return "FULL";
    }
    return streams[0]?.replicationMode ?? "INCREMENTAL";
}

export abstract class AssetTap<C> {
    readonly config: C;
    readonly outputDir: string;
    readonly streams: AssetStream<unknown>[] = [];
    readonly concurrency: number;

    private readonly target: AssetTarget<unknown>;

    constructor(target: AssetTarget<unknown>, config: C, outputDir = "out", concurrency = 5) {
        this.target = target;
        this.config = config;
        this.outputDir = outputDir;
        this.concurrency = concurrency;
    }

    /** Register streams. Called once at the start of sync(). */
    abstract init(): Promise<void>;

    async sync(): Promise<AssetManifest> {
        await this.init();

        const dryRun = isDryRun();
        const dryRunLimit = dryRun ? getDryRunLimit() : undefined;
        if (dryRun) {
            logger.info(`${logPrefix} [DRY_RUN] mode active — skipping CDN checks and uploads`);
            await fs.emptyDir(this.outputDir);
            if (dryRunLimit !== undefined) {
                logger.info(`${logPrefix} [DRY_RUN] Limit: ${dryRunLimit} assets per stream`);
            }
        } else if (process.env["DRY_RUN_LIMIT"] !== undefined) {
            logger.warn(`${logPrefix} DRY_RUN_LIMIT is set but DRY_RUN is not active — limit will be ignored`);
        }

        const tmpDir = path.join(this.outputDir, "tmp");
        await fs.ensureDir(tmpDir);

        const streamManifests: StreamManifest[] = [];
        let entryIndex = 0;
        let totalSummary = { total: 0, uploaded: 0, skipped: 0, errors: 0 };

        for (const stream of this.streams) {
            logger.info(`${logPrefix} Processing stream: ${stream.streamId} (mode=${stream.replicationMode}, concurrency=${this.concurrency})`);

            const assetEntries: AssetManifestEntry[] = [];
            let streamAssetCount = 0;

            await processFromAsyncIterable(
                stream.listAssets(),
                async (entry: AssetEntry) => {
                    // Check dry-run limit early (before any async work) to avoid overshooting under concurrency
                    if (dryRunLimit !== undefined && streamAssetCount >= dryRunLimit) {
                        return "stop";
                    }

                    logger.debug(`${logPrefix} Processing entry: ${entry.sourcePath}`);

                    // INCREMENTAL: check if we need to sync this file (skip CDN check in DRY_RUN)
                    if (stream.replicationMode === "INCREMENTAL" && !dryRun) {
                        const shouldSync = await this.target.shouldSync(entry);

                        if (!shouldSync) {
                            logger.debug(`${logPrefix} Skipping ${entry.sourcePath} (up-to-date)`);
                            assetEntries.push({
                                sourcePath: entry.sourcePath,
                                destinationPath: entry.destinationPath,
                                downloadedPath: "",
                                transformedPath: "",
                                size: 0,
                                contentType: entry.contentType,
                                status: "skipped",
                                transformed: false,
                            });
                            return "continue";
                        }
                    }

                    // Use counter prefix to avoid basename collisions
                    const fileName = `${entryIndex}_${path.basename(entry.sourcePath)}`;
                    const downloadedPath = path.join(tmpDir, fileName);
                    let uploadPath = downloadedPath;
                    entryIndex++;
                    streamAssetCount++;

                    try {
                        await stream.downloadEntry(entry, downloadedPath);

                        uploadPath = await stream.transformFile(downloadedPath, entry);
                        const wasTransformed = uploadPath !== downloadedPath;

                        const stat = await fs.stat(uploadPath);
                        const processed: ProcessedAsset = {
                            entry,
                            downloadedPath,
                            uploadPath,
                            wasTransformed,
                            size: stat.size,
                            contentType: wasTransformed
                                ? inferContentType(uploadPath, entry.contentType)
                                : entry.contentType,
                        };

                        if (!dryRun) {
                            await this.target.uploadAsset(processed);
                        } else {
                            const inspectPath = path.join(this.outputDir, stream.streamId, entry.destinationPath);
                            await fs.ensureDir(path.dirname(inspectPath));
                            await fs.copy(uploadPath, inspectPath);

                            // Save the original (pre-transform) file for before/after comparison
                            if (wasTransformed) {
                                const baseName = path.basename(entry.destinationPath, path.extname(entry.destinationPath));
                                const origExt = getExtension(entry.contentType);
                                const originalPath = path.join(this.outputDir, "originals", `${baseName}${origExt}`);
                                await fs.ensureDir(path.dirname(originalPath));
                                await fs.copy(downloadedPath, originalPath);
                            }
                        }

                        assetEntries.push({
                            sourcePath: entry.sourcePath,
                            destinationPath: entry.destinationPath,
                            downloadedPath,
                            transformedPath: wasTransformed ? uploadPath : "",
                            size: processed.size,
                            contentType: processed.contentType,
                            status: "uploaded",
                            transformed: wasTransformed,
                        });

                        logger.info(`${logPrefix} ${dryRun ? "[DRY_RUN] Processed" : "Uploaded"} ${entry.sourcePath} → ${entry.destinationPath}`);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        logger.error(`${logPrefix} Failed to process ${entry.sourcePath}: ${message}`);
                        assetEntries.push({
                            sourcePath: entry.sourcePath,
                            destinationPath: entry.destinationPath,
                            downloadedPath: "",
                            transformedPath: "",
                            size: 0,
                            contentType: entry.contentType,
                            status: "error",
                            transformed: false,
                            error: message,
                        });
                    } finally {
                        await fs.remove(downloadedPath).catch(() => undefined);
                        if (uploadPath !== downloadedPath) {
                            await fs.remove(uploadPath).catch(() => undefined);
                        }
                    }

                    if (dryRunLimit !== undefined && streamAssetCount >= dryRunLimit) {
                        logger.info(`${logPrefix} [DRY_RUN] Reached limit of ${dryRunLimit} for stream "${stream.streamId}", stopping.`);
                        return "stop";
                    }

                    return "continue";
                },
                this.concurrency,
            );

            const streamSummary = {
                total: assetEntries.length,
                uploaded: assetEntries.filter(a => a.status === "uploaded").length,
                skipped: assetEntries.filter(a => a.status === "skipped").length,
                errors: assetEntries.filter(a => a.status === "error").length,
            };

            totalSummary.total += streamSummary.total;
            totalSummary.uploaded += streamSummary.uploaded;
            totalSummary.skipped += streamSummary.skipped;
            totalSummary.errors += streamSummary.errors;

            streamManifests.push({
                streamId: stream.streamId,
                mode: stream.replicationMode,
                syncedAt: new Date().toISOString(),
                assets: assetEntries,
                summary: streamSummary,
            });
        }

        const manifest: AssetManifest = {
            syncedAt: new Date().toISOString(),
            mode: deriveManifestMode(this.streams),
            streams: streamManifests,
            summary: totalSummary,
        };

        await fs.ensureDir(this.outputDir);
        await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

        if (!dryRun) {
            await this.target.complete();
        }

        logger.info(`${logPrefix} Sync complete. Uploaded=${totalSummary.uploaded} Skipped=${totalSummary.skipped} Errors=${totalSummary.errors}`);
        return manifest;
    }

}
