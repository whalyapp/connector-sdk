import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DocumentEntry } from "../document-tap/types";

const mockService = {
    listAllDocuments: vi.fn(),
    uploadFile: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
    objectStorageId: "objst_test",
};

class MockWhalyDocumentService {
    objectStorageId: string;
    constructor(_config: any) {
        this.objectStorageId = _config.objectStorageId;
        Object.assign(this, mockService);
    }
}

vi.mock("../../../services/whaly-document", () => ({
    WhalyDocumentService: MockWhalyDocumentService,
}));

describe("WhalyDocumentTarget", () => {
    let target: any;

    beforeEach(async () => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";

        vi.clearAllMocks();

        const { WhalyDocumentTarget } = await import("./whaly-document-target");
        target = new WhalyDocumentTarget({ objectStorageId: "objst_test" });
    });

    it("constructs without error", () => {
        expect(target.config.objectStorageId).toBe("objst_test");
    });

    describe("createDocument", () => {
        it("uploads file then creates document record", async () => {
            mockService.uploadFile.mockResolvedValueOnce({ storage: "gcs", filePath: "stream/doc.pdf", sizeKb: 42 });
            mockService.createDocument.mockResolvedValueOnce({ id: "new-1" });

            const entry: DocumentEntry = {
                externalId: "ext-1",
                fileName: "test.pdf",
                originalFileName: "test.pdf",
                extension: "pdf",
            };

            const fsMod = await import("fs-extra");
            vi.spyOn(fsMod.default, "stat").mockResolvedValueOnce({ size: 43008 } as any);

            await target.createDocument("my-stream", entry, "/tmp/test.pdf");

            expect(mockService.uploadFile).toHaveBeenCalledWith(
                "my-stream/ext-1.pdf",
                "/tmp/test.pdf",
                "ext-1.pdf",
            );
            expect(mockService.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({
                    file_name: "test.pdf",
                    external_id: "ext-1",
                    original_file_name: "test.pdf",
                    extension: "pdf",
                    file_path: "stream/doc.pdf",
                    storage: "gcs",
                    size_kb: 42,
                }),
            );
        });
    });

    describe("updateDocumentMetadata", () => {
        it("sends all metadata fields including originalFileName and originalFilePath", async () => {
            mockService.updateDocument.mockResolvedValueOnce({});

            const entry: DocumentEntry = {
                externalId: "ext-1",
                fileName: "new-name.pdf",
                originalFileName: "source-name.pdf",
                originalFilePath: "/docs/source-name.pdf",
                originalAuthor: "Author",
                extension: "pdf",
                validFrom: "2026-01-01",
                validUntil: "2027-01-01",
                metadata: { key: "value" },
            };

            const existingDoc = {
                id: "doc-1",
                file_name: "old-name.pdf",
                external_id: "ext-1",
                original_file_name: "source-name.pdf",
                original_file_path: "/docs/source-name.pdf",
                original_author: "Author",
                extension: "pdf",
                file_path: "stream/old-name.pdf",
                valid_from: "",
                valid_until: "",
                size_kb: 42,
                storage: "storage-1",
                metadata: {},
                document_source_id: "docsrc_existing",
            };

            await target.updateDocumentMetadata("doc-1", entry, existingDoc);

            expect(mockService.updateDocument).toHaveBeenCalledWith("doc-1", {
                external_id: "ext-1",
                file_name: "new-name.pdf",
                original_file_name: "source-name.pdf",
                original_file_path: "/docs/source-name.pdf",
                original_author: "Author",
                extension: "pdf",
                file_path: "stream/old-name.pdf",
                valid_from: "2026-01-01",
                valid_until: "2027-01-01",
                size_kb: 42,
                storage: "storage-1",
                metadata: { key: "value" },
                document_source_id: "docsrc_existing",
            });
        });
    });

    describe("deleteDocument", () => {
        it("calls service.deleteDocument with the id", async () => {
            mockService.deleteDocument.mockResolvedValueOnce(undefined);

            await target.deleteDocument("doc-1", "ext-1");

            expect(mockService.deleteDocument).toHaveBeenCalledWith("doc-1");
        });
    });

    describe("listExistingDocuments", () => {
        it("delegates to service.listAllDocuments", async () => {
            const docs = [{ id: "1", external_id: "doc-1" }];
            mockService.listAllDocuments.mockResolvedValueOnce(docs);

            const result = await target.listExistingDocuments();

            expect(result).toEqual(docs);
            expect(mockService.listAllDocuments).toHaveBeenCalledTimes(1);
            expect(mockService.listAllDocuments).toHaveBeenCalledWith();
        });
    });

    describe("document source scoping", () => {
        it("creates new documents in the org default source when unscoped", async () => {
            mockService.uploadFile.mockResolvedValueOnce({ storage: "gcs", filePath: "s/d.pdf", sizeKb: 1 });
            mockService.createDocument.mockResolvedValueOnce({ id: "new-1" });
            const fsMod = await import("fs-extra");
            vi.spyOn(fsMod.default, "stat").mockResolvedValueOnce({ size: 1024 } as any);

            const entry: DocumentEntry = { externalId: "ext-1", fileName: "t.pdf", originalFileName: "t.pdf", extension: "pdf" };
            await target.createDocument("stream", entry, "/tmp/t.pdf");

            expect(mockService.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({ document_source_id: null }),
            );
        });

        it("fetches per source and creates in the first source when scoped", async () => {
            const { WhalyDocumentTarget } = await import("./whaly-document-target");
            const scoped = new WhalyDocumentTarget({
                objectStorageId: "objst_test",
                documentSourceIds: ["docsrc_a", "docsrc_b"],
            });

            mockService.listAllDocuments
                .mockResolvedValueOnce([{ id: "1", external_id: "doc-1", document_source_id: "docsrc_a" }])
                .mockResolvedValueOnce([{ id: "2", external_id: "doc-2", document_source_id: "docsrc_b" }]);

            const result = await scoped.listExistingDocuments();

            expect(result).toHaveLength(2);
            expect(mockService.listAllDocuments).toHaveBeenCalledTimes(2);
            expect(mockService.listAllDocuments).toHaveBeenNthCalledWith(1, "docsrc_a");
            expect(mockService.listAllDocuments).toHaveBeenNthCalledWith(2, "docsrc_b");

            mockService.uploadFile.mockResolvedValueOnce({ storage: "gcs", filePath: "s/d.pdf", sizeKb: 1 });
            mockService.createDocument.mockResolvedValueOnce({ id: "new-1" });
            const fsMod = await import("fs-extra");
            vi.spyOn(fsMod.default, "stat").mockResolvedValueOnce({ size: 1024 } as any);

            const entry: DocumentEntry = { externalId: "ext-1", fileName: "t.pdf", originalFileName: "t.pdf", extension: "pdf" };
            await scoped.createDocument("stream", entry, "/tmp/t.pdf");

            expect(mockService.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({ document_source_id: "docsrc_a" }),
            );
        });

        it("preserves the document's current source on reupload", async () => {
            mockService.uploadFile.mockResolvedValueOnce({ storage: "gcs", filePath: "s/d.pdf", sizeKb: 1 });
            mockService.updateDocument.mockResolvedValueOnce({});
            const fsMod = await import("fs-extra");
            vi.spyOn(fsMod.default, "stat").mockResolvedValueOnce({ size: 1024 } as any);

            const entry: DocumentEntry = { externalId: "ext-1", fileName: "t.pdf", originalFileName: "t.pdf", extension: "pdf" };
            await target.reuploadDocument("stream", "doc-1", entry, "/tmp/t.pdf", "docsrc_b");

            expect(mockService.updateDocument).toHaveBeenCalledWith(
                "doc-1",
                expect.objectContaining({ document_source_id: "docsrc_b" }),
            );
        });
    });
});
