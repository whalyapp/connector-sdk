import { describe, it, expect } from "vitest";
import { DocumentStream } from "./document-stream";
import type { DocumentEntry, WhalyDocument } from "./types";

class TestStream extends DocumentStream<{}> {
    private items: DocumentEntry[];
    constructor(items: DocumentEntry[] = []) {
        super("test-stream", {});
        this.items = items;
    }
    async *listDocuments() {
        for (const item of this.items) yield item;
    }
    async downloadDocument(_entry: DocumentEntry, _destPath: string) {
        // no-op for tests
    }
}

function makeWhalyDoc(overrides: Partial<WhalyDocument> = {}): WhalyDocument {
    return {
        id: "doc-1",
        file_name: "test.pdf",
        external_id: "ext-1",
        original_file_name: "test.pdf",
        original_file_path: "/path/test.pdf",
        original_author: "Author",
        extension: "pdf",
        file_path: "stream/ext-1.pdf",
        valid_from: "2024-01-01",
        valid_until: "2025-01-01",
        size_kb: 100,
        storage: "storage-1",
        metadata: {},
        ...overrides,
    };
}

describe("DocumentStream", () => {
    describe("shouldReupload", () => {
        it("returns true by default (conservative)", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf", lastModified: new Date(),
            };
            expect(stream.shouldReupload(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when lastModified is undefined", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                extension: "pdf",
            };
            expect(stream.shouldReupload(entry, makeWhalyDoc())).toBe(true);
        });
    });

    describe("shouldUpdateMetadata", () => {
        it("returns false when all fields match", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                originalFilePath: "/path/test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(false);
        });

        it("returns true when originalFileName differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "renamed.pdf",
                originalFilePath: "/path/test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when originalFilePath differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                originalFilePath: "/new-path/test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when fileName differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "new-name.pdf", originalFileName: "test.pdf",
                originalFilePath: "/path/test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when metadata differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                originalFilePath: "/path/test.pdf",
                extension: "pdf", validFrom: "2024-01-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: { tag: "new" },
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });

        it("returns true when validFrom differs", () => {
            const stream = new TestStream();
            const entry: DocumentEntry = {
                externalId: "ext-1", fileName: "test.pdf", originalFileName: "test.pdf",
                originalFilePath: "/path/test.pdf",
                extension: "pdf", validFrom: "2024-06-01", validUntil: "2025-01-01",
                originalAuthor: "Author", metadata: {},
            };
            expect(stream.shouldUpdateMetadata(entry, makeWhalyDoc())).toBe(true);
        });
    });

    describe("shouldDelete", () => {
        it("returns true by default", () => {
            const stream = new TestStream();
            expect(stream.shouldDelete(makeWhalyDoc())).toBe(true);
        });
    });
});
