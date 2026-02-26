import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("axios", () => {
    const mockInstance = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    };
    return {
        default: { create: vi.fn(() => mockInstance) },
        __mockInstance: mockInstance,
    };
});

vi.mock("axios-retry", () => ({ default: vi.fn() }));

describe("WhalyDocumentService", () => {
    let service: any;
    let mockClient: any;

    beforeEach(async () => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";

        vi.clearAllMocks();
        const mod = await import("./whaly-document");
        service = new mod.WhalyDocumentService({ objectStorageId: "objst_test" });

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
            expect(mockClient.get).toHaveBeenCalledWith("/v1/documents", { params: {} });
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
            expect(mockClient.get).toHaveBeenCalledWith("/v1/documents", { params: { after: "cursor-1" } });
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

            expect(mockClient.post).toHaveBeenCalledWith("/v1/documents", payload);
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

            expect(mockClient.put).toHaveBeenCalledWith("/v1/documents/doc-1", payload);
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
});
