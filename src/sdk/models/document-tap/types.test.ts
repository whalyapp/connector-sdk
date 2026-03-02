import { describe, it, expect } from "vitest";
import { emptyDocumentSummary, addDocumentSummaries } from "./types";

describe("DocumentSummary helpers", () => {
    it("emptyDocumentSummary returns all zeros", () => {
        const s = emptyDocumentSummary();
        expect(s).toEqual({ total: 0, created: 0, updated: 0, reuploaded: 0, deleted: 0, skipped: 0, errors: 0 });
    });

    it("addDocumentSummaries sums each field", () => {
        const a = { total: 3, created: 1, updated: 1, reuploaded: 0, deleted: 0, skipped: 1, errors: 0 };
        const b = { total: 2, created: 0, updated: 0, reuploaded: 1, deleted: 1, skipped: 0, errors: 0 };
        expect(addDocumentSummaries(a, b)).toEqual({
            total: 5, created: 1, updated: 1, reuploaded: 1, deleted: 1, skipped: 1, errors: 0,
        });
    });
});
