import fs from "fs-extra";
import path from "node:path";
import { logger } from "../../service/logger";
import { runWithConcurrency } from "../../service/concurrency";
import { isDryRun, getDryRunLimit } from "../../service/dryRun";
import type { DocumentStream } from "./document-stream";
import type { WhalyDocumentTarget } from "../document-target/whaly-document-target";
import type {
    DocumentEntry,
    WhalyDocument,
    DocumentManifest,
    DocumentManifestEntry,
    DocumentStreamManifest,
    DocumentSummary,
} from "./types";
import { emptyDocumentSummary, addDocumentSummaries } from "./types";

const logPrefix = "[DocumentTap]";

interface DiffResult {
    toCreate: DocumentEntry[];
    toReupload: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }>;
    toUpdateMetadata: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }>;
    toDelete: WhalyDocument[];
    skipped: DocumentEntry[];
}

export abstract class DocumentTap<C> {
    readonly config: C;
    readonly outputDir: string;
    readonly streams: DocumentStream<unknown>[] = [];
    readonly concurrency: number;

    target!: WhalyDocumentTarget;

    constructor(config: C, outputDir = "out", concurrency = 5) {
        this.config = config;
        this.outputDir = outputDir;
        this.concurrency = concurrency;
    }

    /** Register streams. Called once at the start of sync(). */
    abstract init(): Promise<void>;

    async sync(): Promise<DocumentManifest> {
        if (!this.target) {
            throw new Error(`${logPrefix} No target set. Assign a WhalyDocumentTarget before calling sync().`);
        }

        await this.init();

        const dryRun = isDryRun();
        const dryRunLimit = dryRun ? getDryRunLimit() : undefined;
        if (dryRun) {
            logger.info(`${logPrefix} [DRY_RUN] mode active — skipping API calls and uploads`);
            await fs.emptyDir(this.outputDir);
            if (dryRunLimit !== undefined) {
                logger.info(`${logPrefix} [DRY_RUN] Limit: ${dryRunLimit} documents per stream`);
            }
        }

        const tmpDir = path.join(this.outputDir, "tmp");
        await fs.ensureDir(tmpDir);

        const streamManifests: DocumentStreamManifest[] = [];
        let totalSummary = emptyDocumentSummary();

        for (const stream of this.streams) {
            logger.info(`${logPrefix} Processing stream: ${stream.streamId}`);

            // 1. LIST PHASE
            const sourceEntries = await this.collectSourceEntries(stream, dryRunLimit);
            const existingDocs = dryRun ? [] : await this.target.listExistingDocuments();

            // 2. DIFF PHASE
            const diff = this.computeDiff(stream, sourceEntries, existingDocs);

            logger.info(`${logPrefix} Stream ${stream.streamId} diff: ` +
                `create=${diff.toCreate.length} reupload=${diff.toReupload.length} ` +
                `updateMeta=${diff.toUpdateMetadata.length} delete=${diff.toDelete.length} ` +
                `skip=${diff.skipped.length}`);

            // 3. EXECUTE PHASE
            const entries: DocumentManifestEntry[] = [];

            const createTasks = diff.toCreate.map(entry => async () => {
                return this.executeCreate(stream, entry, tmpDir, dryRun);
            });

            const reuploadTasks = diff.toReupload.map(({ entry, existingDoc }) => async () => {
                return this.executeReupload(stream, entry, existingDoc, tmpDir, dryRun);
            });

            const metadataTasks = diff.toUpdateMetadata.map(({ entry, existingDoc }) => async () => {
                return this.executeMetadataUpdate(entry, existingDoc, dryRun);
            });

            const deleteTasks = diff.toDelete.map(doc => async () => {
                return this.executeDelete(doc, dryRun);
            });

            const allTasks = [...createTasks, ...reuploadTasks, ...metadataTasks, ...deleteTasks];
            const results = await runWithConcurrency(allTasks, this.concurrency);
            entries.push(...results);

            for (const entry of diff.skipped) {
                entries.push({ externalId: entry.externalId, fileName: entry.fileName, status: "skipped" });
            }

            // 4. MANIFEST PHASE
            const streamSummary = this.computeSummary(entries);
            totalSummary = addDocumentSummaries(totalSummary, streamSummary);

            streamManifests.push({
                streamId: stream.streamId,
                syncedAt: new Date().toISOString(),
                documents: entries,
                summary: streamSummary,
            });
        }

        const manifest: DocumentManifest = {
            syncedAt: new Date().toISOString(),
            streams: streamManifests,
            summary: totalSummary,
        };

        await fs.ensureDir(this.outputDir);
        await fs.writeJson(path.join(this.outputDir, "manifest.json"), manifest, { spaces: 2 });

        // Cleanup tmp
        await fs.remove(tmpDir).catch(() => undefined);

        logger.info(`${logPrefix} Sync complete. Created=${totalSummary.created} Updated=${totalSummary.updated} ` +
            `Reuploaded=${totalSummary.reuploaded} Deleted=${totalSummary.deleted} ` +
            `Skipped=${totalSummary.skipped} Errors=${totalSummary.errors}`);

        return manifest;
    }

    private async collectSourceEntries(stream: DocumentStream<unknown>, limit?: number): Promise<DocumentEntry[]> {
        const entries: DocumentEntry[] = [];
        for await (const entry of stream.listDocuments()) {
            entries.push(entry);
            if (limit !== undefined && entries.length >= limit) break;
        }
        return entries;
    }

    private computeDiff(
        stream: DocumentStream<unknown>,
        sourceEntries: DocumentEntry[],
        existingDocs: WhalyDocument[],
    ): DiffResult {
        const existingByExternalId = new Map<string, WhalyDocument>();
        for (const doc of existingDocs) {
            existingByExternalId.set(doc.external_id, doc);
        }

        const toCreate: DocumentEntry[] = [];
        const toReupload: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }> = [];
        const toUpdateMetadata: Array<{ entry: DocumentEntry; existingDoc: WhalyDocument }> = [];
        const skipped: DocumentEntry[] = [];
        const matchedExternalIds = new Set<string>();

        for (const entry of sourceEntries) {
            const existing = existingByExternalId.get(entry.externalId);
            if (!existing) {
                toCreate.push(entry);
            } else {
                matchedExternalIds.add(entry.externalId);
                const needsReupload = stream.shouldReupload(entry, existing);
                if (needsReupload) {
                    toReupload.push({ entry, existingDoc: existing });
                } else {
                    const needsMetaUpdate = stream.shouldUpdateMetadata(entry, existing);
                    if (needsMetaUpdate) {
                        toUpdateMetadata.push({ entry, existingDoc: existing });
                    } else {
                        skipped.push(entry);
                    }
                }
            }
        }

        // Documents in Whaly but not in source → candidates for deletion
        const toDelete: WhalyDocument[] = [];
        for (const doc of existingDocs) {
            if (!matchedExternalIds.has(doc.external_id)) {
                if (stream.shouldDelete(doc)) {
                    toDelete.push(doc);
                }
            }
        }

        return { toCreate, toReupload, toUpdateMetadata, toDelete, skipped };
    }

    private async executeCreate(
        stream: DocumentStream<unknown>,
        entry: DocumentEntry,
        tmpDir: string,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        const downloadPath = path.join(tmpDir, `${entry.externalId}.${entry.extension}`);
        try {
            await stream.downloadDocument(entry, downloadPath);

            if (!dryRun) {
                await this.target.createDocument(stream.streamId, entry, downloadPath);
            } else {
                const inspectPath = path.join(this.outputDir, stream.streamId, `${entry.externalId}.${entry.extension}`);
                await fs.ensureDir(path.dirname(inspectPath));
                await fs.copy(downloadPath, inspectPath);
            }

            return { externalId: entry.externalId, fileName: entry.fileName, status: "created" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to create ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        } finally {
            await fs.remove(downloadPath).catch(() => undefined);
        }
    }

    private async executeReupload(
        stream: DocumentStream<unknown>,
        entry: DocumentEntry,
        existingDoc: WhalyDocument,
        tmpDir: string,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        const downloadPath = path.join(tmpDir, `${entry.externalId}.${entry.extension}`);
        try {
            await stream.downloadDocument(entry, downloadPath);

            if (!dryRun) {
                await this.target.reuploadDocument(stream.streamId, existingDoc.id, entry, downloadPath);
            } else {
                const inspectPath = path.join(this.outputDir, stream.streamId, `${entry.externalId}.${entry.extension}`);
                await fs.ensureDir(path.dirname(inspectPath));
                await fs.copy(downloadPath, inspectPath);
            }

            return { externalId: entry.externalId, fileName: entry.fileName, status: "reuploaded" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to reupload ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        } finally {
            await fs.remove(downloadPath).catch(() => undefined);
        }
    }

    private async executeMetadataUpdate(
        entry: DocumentEntry,
        existingDoc: WhalyDocument,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        try {
            if (!dryRun) {
                await this.target.updateDocumentMetadata(existingDoc.id, entry);
            }
            return { externalId: entry.externalId, fileName: entry.fileName, status: "updated" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to update metadata for ${entry.externalId}: ${message}`);
            return { externalId: entry.externalId, fileName: entry.fileName, status: "error", error: message };
        }
    }

    private async executeDelete(
        doc: WhalyDocument,
        dryRun: boolean,
    ): Promise<DocumentManifestEntry> {
        try {
            if (!dryRun) {
                await this.target.deleteDocument(doc.id, doc.external_id);
            }
            return { externalId: doc.external_id, fileName: doc.file_name, status: "deleted" };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`${logPrefix} Failed to delete ${doc.external_id}: ${message}`);
            return { externalId: doc.external_id, fileName: doc.file_name, status: "error", error: message };
        }
    }

    private computeSummary(entries: DocumentManifestEntry[]): DocumentSummary {
        const summary = emptyDocumentSummary();
        for (const e of entries) {
            summary.total++;
            if (e.status === "created") summary.created++;
            else if (e.status === "updated") summary.updated++;
            else if (e.status === "reuploaded") summary.reuploaded++;
            else if (e.status === "deleted") summary.deleted++;
            else if (e.status === "skipped") summary.skipped++;
            else if (e.status === "error") summary.errors++;
        }
        return summary;
    }
}
