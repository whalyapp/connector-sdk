import { WorkBook } from "xlsx";
import { ReplicationMethod } from "../models/replication";

// Re-export WorkBook so client projects don't need xlsx as a direct dependency
export type { WorkBook } from "xlsx";

// Re-export ReplicationMethod so file-processing consumers don't need a separate import
export { ReplicationMethod } from "../models/replication";

/**
 * Field types for file processing columns.
 * Maps to JSON Schema types via fieldTypeToJsonSchema().
 */
export type FieldType = "STRING" | "FLOAT" | "TIMESTAMP";

export enum FileFormat {
    CSV = "CSV",
    EXCEL = "EXCEL",
}

// ─── Excel Types ───────────────────────────────────────────────────────

export type ExcelFieldSpec = ExcelSourceColumn | ExcelDerivedField;

export interface ExcelSourceColumn {
    type: FieldType;
    column: string;
    primaryKey?: boolean;
}

export interface ExcelDerivedField {
    variableName: string;
    primaryKey?: boolean;
    type: FieldType;
}

export interface ExcelFieldMapping {
    [key: string]: ExcelFieldSpec;
}

export type ExcelExtractionConfig = ExcelSingleSheetExtractionConfig | ExcelCustomExtractorConfig;

export interface ExcelExtractionBaseConfig {
    type: "single-sheet-extraction" | "processor";
    extension: string;
    fileNameValidator: (fileName: string) => boolean;
    fileNameVariablesExtractor: (fileName: string, workbook?: WorkBook) => { [key: string]: string | undefined };
    tableName: string | ((fileName: string, workbook?: WorkBook, variables?: { [key: string]: string | undefined }) => string);
    replicationMethod: ReplicationMethod;
}

export interface ExcelCustomExtractorConfig extends ExcelExtractionBaseConfig {
    type: "processor";
    processor: (workbook: WorkBook) => Promise<Record<string, string>[]>;
}

export interface ExcelSingleSheetExtractionConfig extends ExcelExtractionBaseConfig {
    type: "single-sheet-extraction";
    columns: ExcelFieldMapping;
    sheetName?: string;
    numberOfRowsToSkip: number;
    /**
     * When true, the sheet is parsed row-by-row with a streaming reader (exceljs)
     * instead of being fully loaded into memory by SheetJS.
     *
     * Use this for very large workbooks: SheetJS materializes each worksheet's XML
     * as a single JS string and silently drops any sheet whose XML exceeds Node's
     * max string length (~0.5 GB), which happens around the 1M-row Excel ceiling.
     * Streaming keeps memory bounded (~tens of MB) regardless of sheet size.
     *
     * Only supported for single-sheet-extraction.
     */
    streaming?: boolean;
}

// ─── CSV Types ─────────────────────────────────────────────────────────

export type CsvFieldsConfig = CsvFieldsArrayConfig | CsvFieldsDictConfig;

export type CsvFieldsArrayConfig = Array<{
    key: string;
    valueTransformer?: (val: any) => string;
    type: FieldType;
}>;

export interface CsvFieldsDictConfig {
    [key: string]: {
        key: string;
        valueTransformer?: (val: any) => string;
        type: FieldType;
    };
}

export interface CsvFileConfig {
    encoding?: string;
    separator: string;
    fields: CsvFieldsConfig;
}

// ─── FileStream Config (discriminated union) ────────────────────────────

interface FileStreamBaseConfig {
    streamId: string;
    replicationMethod: ReplicationMethod;
    primaryKeys: string[];
}

export interface CsvStreamConfig extends FileStreamBaseConfig {
    format: FileFormat.CSV;
    csv: CsvFileConfig;
}

export interface ExcelStreamConfig extends FileStreamBaseConfig {
    format: FileFormat.EXCEL;
    excel: ExcelExtractionConfig;
}

export type FileStreamConfig = CsvStreamConfig | ExcelStreamConfig;

// ─── FileStream Entry (for pairing config + file path) ─────────────────

export interface FileStreamEntry {
    config: FileStreamConfig;
    filePath: string | string[];
}
