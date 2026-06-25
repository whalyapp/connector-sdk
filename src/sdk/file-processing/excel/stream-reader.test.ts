import { describe, it, expect, afterAll } from "vitest";
import XLSX from "xlsx";
import * as fs from "fs";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// SheetJS' ESM build needs fs wired in to read/write files from disk.
XLSX.set_fs(fs);
import { rowGeneratorFromExcelSheet } from "./stream-reader";
import { ExcelSingleSheetExtractionConfig } from "../types";
import { ReplicationMethod } from "../../models/replication";

describe("rowGeneratorFromExcelSheet", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xlsx-stream-test-"));

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const writeWorkbook = (fileName: string, sheets: { name: string; rows: any[][] }[]): string => {
        const wb = XLSX.utils.book_new();
        for (const s of sheets) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
        }
        const filePath = path.join(dir, fileName);
        XLSX.writeFile(wb, filePath);
        return filePath;
    };

    const baseConf = (overrides: Partial<ExcelSingleSheetExtractionConfig> = {}): ExcelSingleSheetExtractionConfig => ({
        type: "single-sheet-extraction",
        extension: "xlsx",
        fileNameValidator: () => true,
        fileNameVariablesExtractor: () => ({}),
        tableName: "t",
        replicationMethod: ReplicationMethod.FULL_TABLE,
        sheetName: "Data",
        numberOfRowsToSkip: 1,
        streaming: true,
        columns: {
            code: { type: "STRING", column: "A", primaryKey: true },
            label: { type: "STRING", column: "B" },
            amount: { type: "FLOAT", column: "C" },
        },
        ...overrides,
    });

    const collect = async (gen: AsyncGenerator<Record<string, any>>) => {
        const out: Record<string, any>[] = [];
        for await (const r of gen) out.push(r);
        return out;
    };

    it("reads the named sheet, skips header, coerces types", async () => {
        const file = writeWorkbook("basic.xlsx", [
            { name: "Other", rows: [["x"]] },
            { name: "Data", rows: [["Code", "Label", "Amount"], ["A1", "Alpha", 1.5], ["B2", "Beta", 3]] },
        ]);
        const rows = await collect(rowGeneratorFromExcelSheet(file, baseConf()));
        expect(rows).toEqual([
            { code: "A1", label: "Alpha", amount: 1.5 },
            { code: "B2", label: "Beta", amount: 3 },
        ]);
    });

    it("resolves shared and inline string values identically", async () => {
        // SheetJS uses shared strings; assert the string survives the round-trip.
        const file = writeWorkbook("strings.xlsx", [
            { name: "Data", rows: [["Code"], ["Café & Thé"], ["A\"B"]] },
        ]);
        const rows = await collect(
            rowGeneratorFromExcelSheet(file, baseConf({ columns: { code: { type: "STRING", column: "A" } } })),
        );
        expect(rows).toEqual([{ code: "Café & Thé" }, { code: "A\"B" }]);
    });

    it("maps blank cells to null and keeps numbers in non-min columns", async () => {
        const file = writeWorkbook("blanks.xlsx", [
            { name: "Data", rows: [["Code", "Label", "Amount"], ["A1", null, 2.5]] },
        ]);
        const rows = await collect(rowGeneratorFromExcelSheet(file, baseConf()));
        expect(rows).toEqual([{ code: "A1", label: null, amount: 2.5 }]);
    });

    it("stops at the first empty value in the lowest source column", async () => {
        const file = writeWorkbook("stop.xlsx", [
            { name: "Data", rows: [
                ["Code", "Label", "Amount"],
                ["A1", "Alpha", 1],
                [null, "Orphan", 2],
                ["C3", "Gamma", 3],
            ] },
        ]);
        const rows = await collect(rowGeneratorFromExcelSheet(file, baseConf()));
        expect(rows).toEqual([{ code: "A1", label: "Alpha", amount: 1 }]);
    });

    it("resolves derived (variableName) fields from the filename", async () => {
        const file = writeWorkbook("derived.xlsx", [
            { name: "Data", rows: [["Code"], ["A1"], ["B2"]] },
        ]);
        const conf = baseConf({
            fileNameVariablesExtractor: () => ({ source: "WHALY" }),
            columns: {
                code: { type: "STRING", column: "A", primaryKey: true },
                origin: { type: "STRING", variableName: "source" },
            },
        });
        const rows = await collect(rowGeneratorFromExcelSheet(file, conf));
        expect(rows).toEqual([
            { code: "A1", origin: "WHALY" },
            { code: "B2", origin: "WHALY" },
        ]);
    });

    it("falls back to the first sheet when no sheetName is configured", async () => {
        const file = writeWorkbook("first.xlsx", [
            { name: "First", rows: [["Code"], ["A1"]] },
            { name: "Second", rows: [["Code"], ["Z9"]] },
        ]);
        const rows = await collect(
            rowGeneratorFromExcelSheet(file, baseConf({ sheetName: undefined, columns: { code: { type: "STRING", column: "A" } } })),
        );
        expect(rows).toEqual([{ code: "A1" }]);
    });

    it("throws when the configured sheet is absent", async () => {
        const file = writeWorkbook("missing.xlsx", [
            { name: "Other", rows: [["Code"], ["A1"]] },
        ]);
        await expect(collect(rowGeneratorFromExcelSheet(file, baseConf({ sheetName: "Nope" })))).rejects.toThrow(
            /Sheet Nope not found/,
        );
    });

    it("honours a multi-row skip", async () => {
        const file = writeWorkbook("skip.xlsx", [
            { name: "Data", rows: [["title row"], ["sub header"], ["Code"], ["A1"], ["B2"]] },
        ]);
        const rows = await collect(
            rowGeneratorFromExcelSheet(file, baseConf({ numberOfRowsToSkip: 3, columns: { code: { type: "STRING", column: "A" } } })),
        );
        expect(rows).toEqual([{ code: "A1" }, { code: "B2" }]);
    });
});
