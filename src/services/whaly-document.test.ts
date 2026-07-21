import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("axios", () => {
    const mockInstance = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    };

    const axiosDefault: any = { create: vi.fn(() => mockInstance) };
    axiosDefault.isAxiosError = (err: any) => err?.isAxiosError === true;
    return {
        default: axiosDefault,
        __mockInstance: mockInstance,
    };
});

vi.mock("axios-retry", () => ({ default: vi.fn() }));

const mockBucketUpload = vi.fn();
vi.mock("@google-cloud/storage", () => {
    function MockStorage() {
        // @ts-ignore
        return { bucket: vi.fn(() => ({ upload: mockBucketUpload })) };
    }
    return { Storage: MockStorage };
});

describe("WhalyDocumentService", () => {
    let service: any;
    let mockClient: any;

    beforeEach(async () => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";

        vi.clearAllMocks();
        const mod = await import("./whaly-document");
        service = new mod.WhalyDocumentService({ objectStorageId: "objst_test", documentSourceId: "docsrc_test" });

        // Access the mock axios instance
        const axiosMod = await import("axios");
        mockClient = (axiosMod as any).__mockInstance;
    });

    it("constructs without error when env vars are set", () => {
        expect(service.objectStorageId).toBe("objst_test");
    });

    describe("listAllDocuments", () => {
        it("fetches a single page of documents", async () => {
            mockClient.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: "1", external_id: "doc-1" }, { id: "2", external_id: "doc-2" }],
                    paging: {},
                },
            });

            const docs = await service.listAllDocuments();

            expect(docs).toHaveLength(2);
            expect(mockClient.get).toHaveBeenCalledTimes(1);
            expect(mockClient.get).toHaveBeenCalledWith("/v1/documents", { params: { document_source_id: "docsrc_test" } });
        });

        it("handles cursor-based pagination", async () => {
            mockClient.get
                .mockResolvedValueOnce({
                    data: {
                        data: [{ id: "1", external_id: "doc-1" }],
                        paging: { next: { after: "cursor-1" } },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        data: [{ id: "2", external_id: "doc-2" }],
                        paging: {},
                    },
                });

            const docs = await service.listAllDocuments();

            expect(docs).toHaveLength(2);
            expect(mockClient.get).toHaveBeenCalledTimes(2);
            expect(mockClient.get).toHaveBeenCalledWith("/v1/documents", { params: { document_source_id: "docsrc_test", after: "cursor-1" } });
        });

        it("returns empty array when no documents exist", async () => {
            mockClient.get.mockResolvedValueOnce({
                data: { data: [], paging: {} },
            });

            const docs = await service.listAllDocuments();
            expect(docs).toHaveLength(0);
        });
    });

    describe("createDocument", () => {
        it("posts to /v1/documents and returns the result", async () => {
            const payload = { file_name: "test.pdf", external_id: "ext-1" };
            mockClient.post.mockResolvedValueOnce({
                data: { data: { id: "new-1", ...payload } },
            });

            const result = await service.createDocument(payload);

            expect(mockClient.post).toHaveBeenCalledWith("/v1/documents", { ...payload, document_source_id: "docsrc_test" });
            expect(result.id).toBe("new-1");
        });
    });

    describe("updateDocument", () => {
        it("puts to /v1/documents/:id and returns the result", async () => {
            const payload = { file_name: "updated.pdf" };
            mockClient.put.mockResolvedValueOnce({
                data: { data: { id: "doc-1", ...payload } },
            });

            const result = await service.updateDocument("doc-1", payload);

            expect(mockClient.put).toHaveBeenCalledWith("/v1/documents/doc-1", { id: "doc-1", ...payload, document_source_id: "docsrc_test" });
            expect(result.file_name).toBe("updated.pdf");
        });
    });

    describe("deleteDocument", () => {
        it("deletes /v1/documents/:id", async () => {
            mockClient.delete.mockResolvedValueOnce({});

            await service.deleteDocument("doc-1");

            expect(mockClient.delete).toHaveBeenCalledWith("/v1/documents/doc-1");
        });
    });

    describe("enrichAxiosError (via createDocument)", () => {
        it("enriches AxiosError with method, url, status, and body", async () => {
            const axiosErr: any = new Error("Request failed");
            axiosErr.isAxiosError = true;
            axiosErr.response = { status: 422, data: { error: "invalid" } };
            axiosErr.config = { method: "post", url: "/v1/documents" };
            mockClient.post.mockRejectedValueOnce(axiosErr);

            await expect(service.createDocument({ file_name: "test.pdf" })).rejects.toThrow(
                /POST \/v1\/documents failed with status 422/,
            );
        });

        it("preserves original error as cause", async () => {
            const axiosErr: any = new Error("Request failed");
            axiosErr.isAxiosError = true;
            axiosErr.response = { status: 500, data: "Internal Server Error" };
            axiosErr.config = { method: "post", url: "/v1/documents" };
            mockClient.post.mockRejectedValueOnce(axiosErr);

            try {
                await service.createDocument({ file_name: "test.pdf" });
            } catch (err: any) {
                expect(err.cause).toBe(axiosErr);
            }
        });

        it("wraps non-Axios errors without enrichment", async () => {
            mockClient.post.mockRejectedValueOnce(new Error("network down"));

            await expect(service.createDocument({ file_name: "test.pdf" })).rejects.toThrow("network down");
        });

        it("wraps non-Error values as strings", async () => {
            mockClient.post.mockRejectedValueOnce("something broke");

            await expect(service.createDocument({ file_name: "test.pdf" })).rejects.toThrow("something broke");
        });
    });
});

describe("WhalyDocumentService (GCS upload)", () => {
    let service: any;
    let tmpFile: string;

    beforeEach(async () => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
        process.env["WLY_GCS_BUCKET"] = "my-bucket";

        vi.clearAllMocks();
        mockBucketUpload.mockResolvedValue(undefined);

        const mod = await import("./whaly-document");
        service = new mod.WhalyDocumentService({ objectStorageId: "objst_test", documentSourceId: "docsrc_test" });

        tmpFile = path.join(os.tmpdir(), `gcs-test-${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, "hello world");
    });

    afterEach(() => {
        delete process.env["WLY_GCS_BUCKET"];
        fs.unlinkSync(tmpFile);
    });

    it("uploads via GCS when WLY_GCS_BUCKET is set", async () => {
        const result = await service.uploadFile("dest/path.txt", tmpFile, "file.txt");

        expect(mockBucketUpload).toHaveBeenCalledWith(tmpFile, { destination: "dest/path.txt" });
        expect(result.storage).toBe("objst_test");
        expect(result.filePath).toBe("dest/path.txt");
        expect(result.sizeKb).toBeGreaterThanOrEqual(1);
    });

    it("retries on transient GCS failure", async () => {
        mockBucketUpload
            .mockRejectedValueOnce(new Error("transient"))
            .mockResolvedValueOnce(undefined);

        const result = await service.uploadFile("dest/path.txt", tmpFile, "file.txt");

        expect(mockBucketUpload).toHaveBeenCalledTimes(2);
        expect(result.filePath).toBe("dest/path.txt");
    });

});
