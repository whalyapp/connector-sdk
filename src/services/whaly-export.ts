import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { logger } from "../sdk/service/logger";
import { getApiEndpoint } from "../sdk/service/apiEndpoint";
import { getServiceAccountKey } from "../sdk/service/serviceAccountKey";

/**
 * Client of the Whaly public exports API (`/v1/exports`).
 *
 * An export is a fixed output schema over a Whaly object, defined in the Whaly app and granted to a
 * service account. A run snapshots the data and writes it as gzip-compressed JSON lines, split in
 * parts of at most 1,000,000 rows; the files are kept 7 days after the run completes.
 */

export type WhalyExportColumnType = "string" | "integer" | "decimal" | "float" | "boolean" | "date" | "datetime";

export interface WhalyExportColumn {
    /** Output column name, as written in every row. */
    name: string;
    type: WhalyExportColumnType;
    nullable: boolean;
}

export interface WhalyExportRunRef {
    id: string;
    completed_at: string | null;
}

export interface WhalyExportDefinition {
    /** Public id of the export (`expt_…`). */
    id: string;
    reference_id: string;
    name: string;
    object: { id: string; reference_id: string | null };
    format: "jsonl.gz";
    /** The output columns that identify a row. Rows are sorted by them. */
    primary_key: string[];
    /** The output schema, in column order. */
    columns: WhalyExportColumn[];
    /** Incremented on every change of the output schema. */
    schema_version: number;
    schema_hash: string;
    last_succeeded_run: WhalyExportRunRef | null;
}

export type WhalyExportRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

export interface WhalyExportFile {
    name: string;
    row_count: number;
    size_bytes: number;
    sha256: string;
    /** Signed download URL, valid for 15 minutes. */
    url: string | null;
    url_expires_at: string | null;
}

export interface WhalyExportRunErrorDetail {
    kind: string;
    message: string;
    step: string | null;
}

export interface WhalyExportRun {
    id: string;
    status: WhalyExportRunStatus;
    trigger: "api" | "factory";
    created_at: string | null;
    started_at: string | null;
    /** Every row reflects the data as of this instant. */
    snapshot_at: string | null;
    completed_at: string | null;
    /** When the files are deleted. */
    expires_at: string | null;
    row_count: number | null;
    size_bytes: number | null;
    schema_version: number | null;
    schema_hash: string | null;
    manifest: { url: string | null; url_expires_at: string | null } | null;
    /** The parts, in key order. */
    files: WhalyExportFile[];
    error: WhalyExportRunErrorDetail | null;
}

/**
 * One exported row. Numbers come as JSON strings (`"184"`, `"1312.50"`), dates as `YYYY-MM-DD`, datetimes as
 * ISO 8601 UTC, empty values as `null`. Every key is present on every row.
 */
export type WhalyExportRow = Record<string, string | boolean | null>;

export interface WhalyExportServiceConfig {
    /** e.g. "https://org.my.whaly.io". Defaults to the `WLY_API_ENDPOINT` env. */
    apiEndpoint?: string;
    /** e.g. "sk:xxxx". Defaults to the `WLY_SERVICE_ACCOUNT_KEY` env. */
    serviceAccountKey?: string;
}

export interface WaitForRunOptions {
    /** Give up after this long (default 30 minutes). The run keeps going on the Whaly side. */
    timeoutMs?: number;
    /** First delay between two polls (default 2 s), multiplied by 1.5 after each poll. */
    pollIntervalMs?: number;
    /** Longest delay between two polls (default 15 s). */
    maxPollIntervalMs?: number;
}

/** A run that did not succeed (failed, cancelled, expired) or did not finish in time. */
export class WhalyExportRunError extends Error {
    constructor(message: string, readonly exportId: string, readonly run: WhalyExportRun | undefined) {
        super(message);
        this.name = "WhalyExportRunError";
    }
}

interface PaginatedResponse<T> {
    data: T[];
    paging: { next?: { after?: string } };
}

const logPrefix = "[WhalyExportService]";
const MAX_RETRIES = 10;
const FINAL_STATUSES: ReadonlySet<WhalyExportRunStatus> = new Set(["succeeded", "failed", "cancelled", "expired"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function enrichAxiosError(err: unknown): Error {
    if (!axios.isAxiosError(err)) return err instanceof Error ? err : new Error(String(err));
    const status = err.response?.status;
    const body = err.response?.data;
    const url = err.config?.url;
    const method = err.config?.method?.toUpperCase();
    const detail = typeof body === "string" ? body : JSON.stringify(body ?? "");
    const hint = status === 404 ? " (unknown export or run, or export not granted to this service account)" : "";
    return new Error(`${method} ${url} failed with status ${status}${hint}: ${detail}`, { cause: err });
}

function retryOnTransientErrors(client: AxiosInstance): void {
    axiosRetry(client, {
        retries: MAX_RETRIES,
        retryCondition: (error: AxiosError): boolean => {
            const status = error.response?.status ?? 0;
            return !error.response || status === 429 || (status >= 500 && status < 600);
        },
        retryDelay: (retryCount: number, error: AxiosError): number => {
            const retryAfter = Number(error.response?.headers?.["retry-after"]);
            if (!isNaN(retryAfter) && retryAfter > 0) return retryAfter * 1000;
            const delay = axiosRetry.exponentialDelay(retryCount);
            logger.info(`${logPrefix} Retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES}) for ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
            return delay;
        },
    });
}

export class WhalyExportService {
    private apiClient: AxiosInstance;
    /** Downloads the signed part URLs: no Authorization header (the URL carries its own signature). */
    private downloadClient: AxiosInstance;

    constructor(config: WhalyExportServiceConfig = {}) {
        const resolvedKey = getServiceAccountKey(config.serviceAccountKey);
        const resolvedEndpoint = getApiEndpoint(config.apiEndpoint);

        this.apiClient = axios.create({
            baseURL: resolvedEndpoint,
            timeout: 120_000,
            headers: {
                Authorization: `Bearer ${resolvedKey}`,
                Accept: "application/json",
            },
        });
        retryOnTransientErrors(this.apiClient);

        this.downloadClient = axios.create({ timeout: 600_000 });
        retryOnTransientErrors(this.downloadClient);
    }

    /** Every export granted to this service account, following the pagination. */
    async listExports(): Promise<WhalyExportDefinition[]> {
        const exports: WhalyExportDefinition[] = [];
        let after: string | undefined;
        while (true) {
            const params: Record<string, string> = {};
            if (after) params["after"] = after;
            const page = await this.get<PaginatedResponse<WhalyExportDefinition>>("/v1/exports", params);
            exports.push(...page.data);
            after = page.paging?.next?.after;
            if (!after) break;
        }
        return exports;
    }

    /** One export: its output schema and last successful run. */
    getExport(exportId: string): Promise<WhalyExportDefinition> {
        return this.get(`/v1/exports/${encodeURIComponent(exportId)}`);
    }

    /** Start a run. Returns the run already queued or running when there is one (one run per export at a time). */
    async startRun(exportId: string): Promise<WhalyExportRun> {
        try {
            const res = await this.apiClient.post<WhalyExportRun>(`/v1/exports/${encodeURIComponent(exportId)}/runs`);
            return res.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }

    /** One run. Once succeeded, it carries fresh signed URLs (valid 15 minutes) for its parts. */
    getRun(exportId: string, runId: string): Promise<WhalyExportRun> {
        return this.get(`/v1/exports/${encodeURIComponent(exportId)}/runs/${encodeURIComponent(runId)}`);
    }

    /** Run history, newest first (one page). `{ status: "succeeded", limit: 1 }` is the latest good extract. */
    async listRuns(exportId: string, options: { status?: WhalyExportRunStatus; limit?: number } = {}): Promise<WhalyExportRun[]> {
        const params: Record<string, string> = {};
        if (options.status) params["status"] = options.status;
        if (options.limit !== undefined) params["limit"] = String(options.limit);
        const page = await this.get<PaginatedResponse<WhalyExportRun>>(`/v1/exports/${encodeURIComponent(exportId)}/runs`, params);
        return page.data;
    }

    /** The most recent succeeded run, or undefined when there is none. Its files may have expired. */
    async getLatestSucceededRun(exportId: string): Promise<WhalyExportRun | undefined> {
        const [run] = await this.listRuns(exportId, { status: "succeeded", limit: 1 });
        return run;
    }

    /** Cancel a queued or running run. A finished run is returned unchanged. */
    async cancelRun(exportId: string, runId: string): Promise<WhalyExportRun> {
        try {
            const res = await this.apiClient.post<WhalyExportRun>(
                `/v1/exports/${encodeURIComponent(exportId)}/runs/${encodeURIComponent(runId)}/cancel`,
            );
            return res.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }

    /**
     * Poll a run until it finishes. Resolves with the succeeded run; throws `WhalyExportRunError` when it fails,
     * is cancelled or expired, or does not finish within `timeoutMs`.
     */
    async waitForRun(exportId: string, runId: string, options: WaitForRunOptions = {}): Promise<WhalyExportRun> {
        const timeoutMs = options.timeoutMs ?? 30 * 60_000;
        const maxDelay = options.maxPollIntervalMs ?? 15_000;
        let delay = options.pollIntervalMs ?? 2_000;
        const startedAt = Date.now();

        let run = await this.getRun(exportId, runId);
        while (!FINAL_STATUSES.has(run.status)) {
            if (Date.now() - startedAt > timeoutMs) {
                throw new WhalyExportRunError(
                    `Export ${exportId}: run ${runId} still ${run.status} after ${Math.round(timeoutMs / 1000)}s`,
                    exportId,
                    run,
                );
            }
            await sleep(delay);
            delay = Math.min(maxDelay, Math.round(delay * 1.5));
            run = await this.getRun(exportId, runId);
        }

        if (run.status !== "succeeded") {
            const why = run.error ? `${run.error.kind}: ${run.error.message}` : run.status;
            throw new WhalyExportRunError(`Export ${exportId}: run ${runId} ${run.status} (${why})`, exportId, run);
        }
        logger.info(`${logPrefix} Export ${exportId}: run ${runId} succeeded, ${run.row_count} row(s) as of ${run.snapshot_at}`);
        return run;
    }

    /** Start a run (or join the one in flight) and wait for it to succeed. */
    async runAndWait(exportId: string, options: WaitForRunOptions = {}): Promise<WhalyExportRun> {
        const run = await this.startRun(exportId);
        logger.info(`${logPrefix} Export ${exportId}: run ${run.id} ${run.status}`);
        return this.waitForRun(exportId, run.id, options);
    }

    /**
     * Stream every row of a succeeded run, part after part, in key order. The run is re-read before each part so
     * its signed URL is fresh, and each part's row count is checked against the run's manifest.
     */
    async *streamRows(exportId: string, runId: string): AsyncGenerator<WhalyExportRow> {
        const first = await this.getRun(exportId, runId);
        if (first.status !== "succeeded") {
            throw new WhalyExportRunError(`Export ${exportId}: run ${runId} is ${first.status}, its rows cannot be read`, exportId, first);
        }

        for (let index = 0; index < first.files.length; index++) {
            const run = index === 0 ? first : await this.getRun(exportId, runId);
            const file = run.files[index];
            if (!file) throw new WhalyExportRunError(`Export ${exportId}: run ${runId} lost part ${index}`, exportId, run);
            if (!file.url) {
                throw new WhalyExportRunError(`Export ${exportId}: part ${file.name} has no download URL (run ${run.status})`, exportId, run);
            }

            let rows = 0;
            for await (const row of this.readPart(file.url)) {
                rows += 1;
                yield row;
            }
            if (rows !== file.row_count) {
                throw new WhalyExportRunError(
                    `Export ${exportId}: part ${file.name} has ${rows} row(s), the run announced ${file.row_count}`,
                    exportId,
                    run,
                );
            }
        }
    }

    /** Run an export and collect every row in memory. For small exports; prefer `runAndWait` + `streamRows`. */
    async fetchAllRows(exportId: string, options: WaitForRunOptions = {}): Promise<WhalyExportRow[]> {
        const run = await this.runAndWait(exportId, options);
        const rows: WhalyExportRow[] = [];
        for await (const row of this.streamRows(exportId, run.id)) rows.push(row);
        return rows;
    }

    private async *readPart(url: string): AsyncGenerator<WhalyExportRow> {
        let body: Readable;
        try {
            const res = await this.downloadClient.get<Readable>(url, { responseType: "stream" });
            body = res.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
        const lines = createInterface({ input: body.pipe(createGunzip()), crlfDelay: Infinity });
        for await (const line of lines) {
            if (line.trim()) yield JSON.parse(line) as WhalyExportRow;
        }
    }

    private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
        try {
            const res = await this.apiClient.get<T>(path, params ? { params } : {});
            return res.data;
        } catch (err) {
            throw enrichAxiosError(err);
        }
    }
}
