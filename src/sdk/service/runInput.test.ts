import { afterEach, describe, expect, it } from "vitest";
import { getEmailMetadata, getInputFiles, getRunTrigger } from "./runInput";
import { VariableExtractors } from "../file-processing/file-patterns";

describe("getInputFiles", () => {
    it("returns every file of an email run", () => {
        expect(getInputFiles({ FILE_URI: "email/1/1/a.csv", WLY_FILE_URIS: '["email/1/1/a.csv","email/1/2/b.csv"]' }))
            .toEqual(["email/1/1/a.csv", "email/1/2/b.csv"]);
    });

    it("falls back to FILE_URI for manual uploads", () => {
        expect(getInputFiles({ FILE_URI: "abc/upload.xlsx" })).toEqual(["abc/upload.xlsx"]);
        expect(getInputFiles({ FILE_URI: "abc/upload.xlsx", WLY_FILE_URIS: "" })).toEqual(["abc/upload.xlsx"]);
        expect(getInputFiles({})).toEqual([]);
    });

    it("rejects a malformed list instead of guessing", () => {
        expect(() => getInputFiles({ WLY_FILE_URIS: '{"a":1}' })).toThrow(/JSON array/);
    });
});

describe("getEmailMetadata / getRunTrigger", () => {
    it("reads the email that started the run", () => {
        expect(getEmailMetadata({ WLY_EMAIL_METADATA: '{"from":"bi@acme.com","subject":"Weekly"}' }))
            .toEqual({ from: "bi@acme.com", subject: "Weekly" });
        expect(getEmailMetadata({})).toBeUndefined();
    });

    it("defaults to a manual run", () => {
        expect(getRunTrigger({ WLY_RUN_TRIGGER: "EMAIL" })).toBe("EMAIL");
        expect(getRunTrigger({ WLY_RUN_TRIGGER: "REPLAY" })).toBe("REPLAY");
        expect(getRunTrigger({})).toBe("MANUAL");
    });
});

describe("VariableExtractors.emailSubject", () => {
    const previous = process.env.WLY_EMAIL_METADATA;
    afterEach(() => {
        if (previous === undefined) delete process.env.WLY_EMAIL_METADATA;
        else process.env.WLY_EMAIL_METADATA = previous;
    });

    it("turns a date in the subject into variables", () => {
        process.env.WLY_EMAIL_METADATA = JSON.stringify({ subject: "Sales report 2026-10-13" });
        const extract = VariableExtractors.emailSubject(/(?<reportDate>\d{4}-\d{2}-\d{2})/);
        expect(extract("sales.csv")).toEqual({ reportDate: "2026-10-13" });
    });

    it("is empty without an email", () => {
        delete process.env.WLY_EMAIL_METADATA;
        expect(VariableExtractors.emailSubject(/(?<x>.+)/)("sales.csv")).toEqual({});
    });
});
