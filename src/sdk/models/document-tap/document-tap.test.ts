import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { DocumentTap } from "./document-tap";
import { DocumentStream } from "./document-stream";
import type { DocumentEntry, WhalyDocument, DocumentManifest } from "./types";
import type { WhalyDocumentTarget } from "../document-target/whaly-document-target";

// ---- Stub Target ----

function makeStubTarget(existingDocs: WhalyDocument[] = []) {
    return {
        config: { objectStorageId: "objst_test" } as any,
        listExistingDocuments: vi.fn(async () => existingDocs),
        createDocument: vi.fn(async (_streamId: string, _entry: DocumentEntry, _localFilePath: string) => {}),
        reuploadDocument: vi.fn(async (_streamId: string, _docId: string, _entry: DocumentEntry, _localFilePath: string) => {}),
        updateDocumentMetadata: vi.fn(async (_docId: string, _entry: DocumentEntry) => {}),
        deleteDocument: vi.fn(async (_docId: string, _externalId: string) => {}),
    } as unknown as WhalyDocumentTarget;
}

// ---- Stub Stream ----

class StubStream extends DocumentStream<{}> {
    private items: DocumentEntry[];
    private _shouldReupload: boolean;

    constructor(id: string, items: DocumentEntry[], shouldReupload = true) {
        super(id, {});
        this.items = items;
        this._shouldReupload = shouldReupload;
    }

    async *listDocuments() {
        for (const item of this.items) yield item;
    }

    async downloadDocument(entry: DocumentEntry, destPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, `content-of-${entry.externalId}`);
    }

    shouldReupload(_sourceEntry: DocumentEntry, _existingDoc: WhalyDocument): boolean {
        return this._shouldReupload;
    }
}

// ---- Stub Tap ----

class StubTap extends DocumentTap<{}> {
    private stubStreams: DocumentStream<unknown>[];

    constructor(streams: DocumentStream<unknown>[], outDir: string, concurrency?: number) {
        super({}, outDir, concurrency);
        this.stubStreams = streams;
    }

    async init() {
        for (const s of this.stubStreams) this.streams.push(s);
    }
}

// ---- Helpers ----

function makeEntry(id: string, overrides: Partial<DocumentEntry> = {}): DocumentEntry {
    return {
        externalId: id,
        fileName: `${id}.pdf`,
        originalFileName: `${id}.pdf`,
        extension: "pdf",
        ...overrides,
    };
}

function makeWhalyDoc(externalId: string, overrides: Partial<WhalyDocument> = {}): WhalyDocument {
    return {
        id: `whaly-${externalId}`,
        file_name: `${externalId}.pdf`,
        external_id: externalId,
        original_file_name: `${externalId}.pdf`,
        original_file_path: "",
        original_author: "",
        extension: "pdf",
        file_path: `stream/${externalId}.pdf`,
        valid_from: "",
        valid_until: "",
        size_kb: 100,
        storage: "storage-1",
        metadata: {},
        ...overrides,
    };
}

// ---- Tests ----

describe("DocumentTap", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-tap-test-"));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
        delete process.env["DRY_RUN"];
        delete process.env["DRY_RUN_LIMIT"];
    });

    it("creates documents that are in source but not in target", async () => {
        const entries = [makeEntry("doc-1"), makeEntry("doc-2")];
        const target = makeStubTarget([]);
        const stream = new StubStream("test", entries);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.createDocument).toHaveBeenCalledTimes(2);
        expect(manifest.summary.created).toBe(2);
        expect(manifest.summary.total).toBe(2);
    });

    it("deletes documents that are in target but not in source", async () => {
        const existingDocs = [makeWhalyDoc("orphan-1"), makeWhalyDoc("orphan-2")];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", []);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.deleteDocument).toHaveBeenCalledTimes(2);
        expect(manifest.summary.deleted).toBe(2);
    });

    it("reuploads when shouldReupload returns true for matched docs", async () => {
        const entries = [makeEntry("doc-1")];
        const existingDocs = [makeWhalyDoc("doc-1")];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, true);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.reuploadDocument).toHaveBeenCalledTimes(1);
        expect(manifest.summary.reuploaded).toBe(1);
    });

    it("updates metadata when shouldReupload=false but metadata differs", async () => {
        const entries = [makeEntry("doc-1", { fileName: "new-name.pdf" })];
        const existingDocs = [makeWhalyDoc("doc-1", { file_name: "old-name.pdf" })];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.updateDocumentMetadata).toHaveBeenCalledTimes(1);
        expect(manifest.summary.updated).toBe(1);
    });

    it("skips when shouldReupload=false and metadata matches", async () => {
        const entries = [makeEntry("doc-1", { fileName: "doc-1.pdf", validFrom: "", validUntil: "", originalAuthor: "" })];
        const existingDocs = [makeWhalyDoc("doc-1", { file_name: "doc-1.pdf" })];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.createDocument).not.toHaveBeenCalled();
        expect(target.reuploadDocument).not.toHaveBeenCalled();
        expect(target.updateDocumentMetadata).not.toHaveBeenCalled();
        expect(target.deleteDocument).not.toHaveBeenCalled();
        expect(manifest.summary.skipped).toBe(1);
    });

    it("handles mixed operations in a single sync", async () => {
        const entries = [
            makeEntry("new-doc"),
            makeEntry("existing-doc", { fileName: "updated-name.pdf" }),
        ];
        const existingDocs = [
            makeWhalyDoc("existing-doc", { file_name: "old-name.pdf" }),
            makeWhalyDoc("orphan-doc"),
        ];
        const target = makeStubTarget(existingDocs);
        const stream = new StubStream("test", entries, false);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(manifest.summary.created).toBe(1);
        expect(manifest.summary.updated).toBe(1);
        expect(manifest.summary.deleted).toBe(1);
        expect(manifest.summary.total).toBe(3);
    });

    it("records per-document errors without aborting", async () => {
        const entries = [makeEntry("doc-1"), makeEntry("doc-2")];
        const target = makeStubTarget([]);
        let callCount = 0;
        target.createDocument = vi.fn(async () => {
            callCount++;
            if (callCount === 1) throw new Error("API error");
        }) as any;
        const stream = new StubStream("test", entries);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(manifest.summary.errors).toBe(1);
        expect(manifest.summary.created).toBe(1);
    });

    it("writes manifest.json to outputDir", async () => {
        const target = makeStubTarget([]);
        const stream = new StubStream("test", [makeEntry("doc-1")]);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        await tap.sync();

        const manifestPath = path.join(tmpDir, "manifest.json");
        expect(await fs.pathExists(manifestPath)).toBe(true);
        const manifest: DocumentManifest = await fs.readJson(manifestPath);
        expect(manifest.streams).toHaveLength(1);
        expect(manifest.summary.total).toBe(1);
    });

    it("cleans up tmp files after processing", async () => {
        const target = makeStubTarget([]);
        const stream = new StubStream("test", [makeEntry("doc-1")]);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        await tap.sync();

        const tmpExists = await fs.pathExists(path.join(tmpDir, "tmp"));
        expect(tmpExists).toBe(false);
    });

    it("throws if no target is set", async () => {
        const stream = new StubStream("test", []);
        const tap = new StubTap([stream], tmpDir);

        await expect(tap.sync()).rejects.toThrow("No target set");
    });

    it("respects shouldDelete escape hatch", async () => {
        const existingDocs = [
            makeWhalyDoc("keep-me", { metadata: {} }),
            makeWhalyDoc("delete-me", { metadata: { tag: "sync" } }),
        ];
        const target = makeStubTarget(existingDocs);

        class FilteringStream extends StubStream {
            shouldDelete(doc: WhalyDocument): boolean {
                return Object.keys(doc.metadata).length > 0;
            }
        }

        const stream = new FilteringStream("test", []);
        const tap = new StubTap([stream], tmpDir);
        tap.target = target;

        const manifest = await tap.sync();

        expect(target.deleteDocument).toHaveBeenCalledTimes(1);
        expect(manifest.summary.deleted).toBe(1);
        const deletedEntry = manifest.streams[0]?.documents.find(d => d.status === "deleted");
        expect(deletedEntry?.externalId).toBe("delete-me");
    });

    describe("DRY_RUN mode", () => {
        beforeEach(() => { process.env["DRY_RUN"] = "true"; });

        it("does not call target API methods", async () => {
            const entries = [makeEntry("doc-1")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            await tap.sync();

            expect(target.listExistingDocuments).not.toHaveBeenCalled();
            expect(target.createDocument).not.toHaveBeenCalled();
            expect(target.deleteDocument).not.toHaveBeenCalled();
        });

        it("copies downloaded files to out/<streamId>/ for inspection", async () => {
            const entries = [makeEntry("doc-1")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            await tap.sync();

            const inspectPath = path.join(tmpDir, "test", "doc-1.pdf");
            expect(await fs.pathExists(inspectPath)).toBe(true);
        });

        it("DRY_RUN_LIMIT stops after N documents per stream", async () => {
            process.env["DRY_RUN_LIMIT"] = "2";
            const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];
            const target = makeStubTarget([]);
            const stream = new StubStream("test", entries);
            const tap = new StubTap([stream], tmpDir);
            tap.target = target;

            const manifest = await tap.sync();

            expect(manifest.summary.total).toBe(2);
        });
    });
});
