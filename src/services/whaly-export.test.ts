import { describe, it, expect, beforeEach, vi } from "vitest";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

vi.mock("axios", () => {
    const apiInstance = { get: vi.fn(), post: vi.fn() };
    const downloadInstance = { get: vi.fn() };
    const instances = [apiInstance, downloadInstance];
    let created = 0;
    const axiosDefault: any = { create: vi.fn(() => instances[created++ % 2]) };
    axiosDefault.isAxiosError = (err: any) => err?.isAxiosError === true;
    return { default: axiosDefault, __api: apiInstance, __download: downloadInstance };
});

vi.mock("axios-retry", () => {
    const fn: any = vi.fn();
    fn.exponentialDelay = vi.fn(() => 0);
    return { default: fn };
});

function gzLines(rows: object[]): Readable {
    return Readable.from([gzipSync(rows.map((r) => JSON.stringify(r)).join("\n") + "\n")]);
}

function run(overrides: Record<string, unknown> = {}) {
    return {
        id: "exr_1",
        status: "succeeded",
        trigger: "api",
        snapshot_at: "2026-11-10T13:00:00.000Z",
        row_count: 2,
        files: [{ name: "part-00000.jsonl.gz", row_count: 2, size_bytes: 10, sha256: "x", url: "https://signed/part0", url_expires_at: null }],
        error: null,
        ...overrides,
    };
}

describe("WhalyExportService", () => {
    let service: any;
    let api: any;
    let download: any;
    let WhalyExportRunError: any;

    beforeEach(async () => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
        vi.clearAllMocks();
        const axiosMod: any = await import("axios");
        api = axiosMod.__api;
        download = axiosMod.__download;
        const mod = await import("./whaly-export");
        WhalyExportRunError = mod.WhalyExportRunError;
        service = new mod.WhalyExportService();
        // the constructor creates the API client first, then the download client
        (service as any).apiClient = api;
        (service as any).downloadClient = download;
    });

    it("lists exports across pages", async () => {
        api.get
            .mockResolvedValueOnce({ data: { data: [{ id: "expt_a" }], paging: { next: { after: "c1" } } } })
            .mockResolvedValueOnce({ data: { data: [{ id: "expt_b" }], paging: {} } });

        const exports = await service.listExports();

        expect(exports.map((e: any) => e.id)).toEqual(["expt_a", "expt_b"]);
        expect(api.get).toHaveBeenNthCalledWith(2, "/v1/exports", { params: { after: "c1" } });
    });

    it("explains a 404 (export not granted)", async () => {
        api.get.mockRejectedValueOnce({
            isAxiosError: true,
            response: { status: 404, data: { message: "Not Found" } },
            config: { url: "/v1/exports/expt_x", method: "get" },
        });

        await expect(service.getExport("expt_x")).rejects.toThrow(/not granted to this service account/);
    });

    it("runs an export and waits until it succeeds", async () => {
        api.post.mockResolvedValueOnce({ data: run({ status: "queued", files: [] }) });
        api.get
            .mockResolvedValueOnce({ data: run({ status: "running", files: [] }) })
            .mockResolvedValueOnce({ data: run() });

        const result = await service.runAndWait("expt_a", { pollIntervalMs: 1 });

        expect(result.status).toBe("succeeded");
        expect(api.post).toHaveBeenCalledWith("/v1/exports/expt_a/runs");
        expect(api.get).toHaveBeenCalledTimes(2);
    });

    it("throws WhalyExportRunError when the run fails", async () => {
        api.post.mockResolvedValueOnce({ data: run({ status: "queued" }) });
        api.get.mockResolvedValueOnce({
            data: run({ status: "failed", error: { kind: "timeout", message: "too slow", step: "stream" } }),
        });

        const err = await service.runAndWait("expt_a", { pollIntervalMs: 1 }).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(WhalyExportRunError);
        expect(err.message).toMatch(/failed \(timeout: too slow\)/);
        expect(err.run.status).toBe("failed");
    });

    it("throws WhalyExportRunError on timeout", async () => {
        api.get.mockResolvedValue({ data: run({ status: "running", files: [] }) });

        await expect(service.waitForRun("expt_a", "exr_1", { timeoutMs: 0, pollIntervalMs: 1 })).rejects.toBeInstanceOf(
            WhalyExportRunError,
        );
    });

    it("streams the rows of every part, re-reading the run for a fresh URL", async () => {
        const twoParts = run({
            row_count: 3,
            files: [
                { name: "part-00000.jsonl.gz", row_count: 2, url: "https://signed/part0" },
                { name: "part-00001.jsonl.gz", row_count: 1, url: "https://signed/part1" },
            ],
        });
        api.get.mockResolvedValue({ data: twoParts });
        download.get
            .mockResolvedValueOnce({ data: gzLines([{ id: "1", qty: "2" }, { id: "2", qty: null }]) })
            .mockResolvedValueOnce({ data: gzLines([{ id: "3", qty: "5" }]) });

        const rows: any[] = [];
        for await (const row of service.streamRows("expt_a", "exr_1")) rows.push(row);

        expect(rows).toEqual([{ id: "1", qty: "2" }, { id: "2", qty: null }, { id: "3", qty: "5" }]);
        expect(api.get).toHaveBeenCalledTimes(2);
        expect(download.get).toHaveBeenNthCalledWith(2, "https://signed/part1", { responseType: "stream" });
    });

    it("rejects a part whose row count differs from the run", async () => {
        api.get.mockResolvedValue({ data: run({ files: [{ name: "part-00000.jsonl.gz", row_count: 5, url: "https://signed/p" }] }) });
        download.get.mockResolvedValueOnce({ data: gzLines([{ id: "1" }]) });

        const read = async () => {
            for await (const _ of service.streamRows("expt_a", "exr_1")) { /* drain */ }
        };

        await expect(read()).rejects.toThrow(/has 1 row\(s\), the run announced 5/);
    });

    it("refuses to stream a run that did not succeed", async () => {
        api.get.mockResolvedValueOnce({ data: run({ status: "expired", files: [] }) });

        const read = async () => {
            for await (const _ of service.streamRows("expt_a", "exr_1")) { /* drain */ }
        };

        await expect(read()).rejects.toThrow(/is expired/);
    });
});
