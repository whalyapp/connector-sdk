import XLSX, { WorkBook } from "xlsx";
import path from "path";
import {
    ExcelSourceColumn,
    ExcelExtractionConfig,
    ExcelSingleSheetExtractionConfig,
    ExcelDerivedField,
} from "../types";
import { coerceCellValue } from "../schema-utils";

// Re-export so existing imports from this module keep working
export { coerceCellValue } from "../schema-utils";

/**
 * Converts an Excel column letter (A, B, C, AA, AZ, etc.) to its zero-based index.
 */
export const excelColumnToIndex = (columnLetter: string): number => {
    const letters = columnLetter.toUpperCase();
    let index = 0;

    for (let i = 0; i < letters.length; i++) {
        const charCode = letters.charCodeAt(i);
        if (charCode < 65 || charCode > 90) {
            throw new Error(`Invalid column letter: ${columnLetter}`);
        }
        index = (index * 26) + (charCode - 64);
    }

    return index - 1;
};

/**
 * Converts a zero-based column index to Excel column letter(s).
 */
export const indexToExcelColumn = (columnIndex: number): string => {
    if (columnIndex < 0) {
        throw new Error(`Invalid column index: ${columnIndex}. Must be >= 0`);
    }

    let result = "";
    let index = columnIndex;

    while (true) {
        result = String.fromCharCode(65 + (index % 26)) + result;
        index = Math.floor(index / 26);

        if (index === 0) break;
        index--;
    }

    return result;
};

/**
 * Converts an Excel row number (1-based) to zero-based array index.
 */
export const excelRowToIndex = (rowNumber: string | number): number => {
    const rowNum = typeof rowNumber === "string" ? parseInt(rowNumber, 10) : rowNumber;
    if (isNaN(rowNum) || rowNum < 1) {
        throw new Error(`Invalid row number: ${rowNumber}. Must be >= 1`);
    }
    return rowNum - 1;
};

/**
 * Converts a zero-based array index to Excel row number (1-based).
 */
export const indexToExcelRow = (index: number): number => {
    if (index < 0) {
        throw new Error(`Invalid index: ${index}. Must be >= 0`);
    }
    return index + 1;
};

/**
 * Parses an Excel cell reference (like "A1", "Z24", "AA100") into column and row indices.
 */
export const parseCellReference = (cellRef: string): { columnIndex: number; rowIndex: number } => {
    const match = cellRef.match(/^([A-Z]+)(\d+)$/);
    if (!match) {
        throw new Error(`Invalid cell reference: ${cellRef}. Expected format like "A1", "Z24", "AA100"`);
    }

    const [, columnLetter, rowNumber] = match;
    return {
        columnIndex: excelColumnToIndex(columnLetter!),
        rowIndex: excelRowToIndex(rowNumber!),
    };
};

/**
 * Creates an Excel cell reference from column and row indices.
 */
export const createCellReference = (columnIndex: number, rowIndex: number): string => {
    return indexToExcelColumn(columnIndex) + indexToExcelRow(rowIndex);
};

/**
 * Extract a single Excel sheet based on configuration.
 */
const extractSingleSheetRows = async (
    fileName: string,
    conf: ExcelSingleSheetExtractionConfig,
): Promise<Record<string, string | number | null>[]> => {
    console.log("Extracting single sheet rows from file: %s", fileName);
    const workbook = XLSX.readFile(fileName, { dense: true });
    const sheetKeys = Object.keys(workbook.Sheets);
    const sheet = conf.sheetName
        ? workbook.Sheets[conf.sheetName]
        : workbook.Sheets[sheetKeys[0]!];

    if (!sheet) {
        throw new Error(`Sheet ${conf.sheetName} not found in workbook`);
    }
    const sheetData = sheet["!data"];
    if (!sheetData) {
        throw new Error(`No data in ${conf.sheetName || "first"} sheet`);
    }
    if (sheetData.length === 0) {
        throw new Error(`Sheet ${conf.sheetName || "first"} is empty`);
    }

    const variables = conf.fileNameVariablesExtractor(fileName, workbook);
    const data: Record<string, string | number | null>[] = [];
    let rowIdx = 0;

    // Find minimum column index to determine when to stop processing
    const minColumnIndex = Object.values(conf.columns).reduce((min, column) => {
        return (column as ExcelSourceColumn).column
            ? Math.min(min, excelColumnToIndex((column as ExcelSourceColumn).column))
            : min;
    }, Number.MAX_SAFE_INTEGER);

    for (const row of sheetData) {
        if (rowIdx < conf.numberOfRowsToSkip) {
            rowIdx++;
            continue;
        }

        if (!row) {
            console.log("Empty row at index: %s, skipped processing.", rowIdx);
            continue;
        }

        // Stop processing if the first data column is empty
        if (minColumnIndex !== Number.MAX_SAFE_INTEGER && !row[minColumnIndex]?.v) {
            console.log("stopping processing because of empty value in the first data column (idx: %s)", minColumnIndex);
            break;
        }

        const rowData = Object.entries(conf.columns).reduce<{ [key: string]: string | number | null }>((acc, [key, column]) => {
            if ((column as ExcelDerivedField).variableName) {
                if (!variables) {
                    throw new Error(`No variables extracted from filename, cannot extract derived field ${key}`);
                }
                acc[key] = variables[(column as ExcelDerivedField).variableName] ?? null;
            } else {
                const colIndex = excelColumnToIndex((column as ExcelSourceColumn).column);
                acc[key] = coerceCellValue(row[colIndex]?.v, (column as ExcelSourceColumn).type);
            }
            return acc;
        }, {});

        data.push(rowData);
        rowIdx++;
    }
    console.log("Extracted %s rows from sheet %s", data.length, conf.sheetName || "first");
    return data;
};

/**
 * Low-level Excel extractor: returns array of row records from a workbook.
 */
export const extractExcelRows = async (
    localFilePath: string,
    conf: ExcelExtractionConfig,
): Promise<Record<string, string | number | null>[]> => {
    let data: Record<string, string | number | null>[];

    if (conf.type === "single-sheet-extraction") {
        data = await extractSingleSheetRows(localFilePath, conf);
    } else if (conf.type === "processor") {
        const workbook = XLSX.readFile(localFilePath, { dense: true });
        data = await conf.processor(workbook);
    } else {
        throw new Error(`Unsupported configuration type: ${(conf as any).type}`);
    }

    return data;
};

/**
 * Validates an Excel file configuration.
 */
export const validateExcelConfig = (config: ExcelExtractionConfig): void => {
    if (!config.extension) {
        throw new Error("Extension is required");
    }

    if (!config.tableName) {
        throw new Error("Table name is required");
    }

    if (!config.fileNameValidator || typeof config.fileNameValidator !== "function") {
        throw new Error("File name validator function is required");
    }

    if (!config.fileNameVariablesExtractor || typeof config.fileNameVariablesExtractor !== "function") {
        throw new Error("File name variables extractor function is required");
    }

    if (
        config.type === "single-sheet-extraction" &&
        (!config.columns || Object.keys(config.columns).length === 0)
    ) {
        throw new Error("At least one column configuration is required for single-sheet-extraction");
    }

    if (config.type === "single-sheet-extraction") {
        Object.entries(config.columns).forEach(([key, column]) => {
            if (!column.type) {
                throw new Error(`Column ${key} must have a type`);
            }

            if ((column as ExcelSourceColumn).column) {
                const colLetter = (column as ExcelSourceColumn).column;
                if (!/^[A-Z]+$/i.test(colLetter)) {
                    throw new Error(`Invalid column letter format: ${colLetter}`);
                }
            } else if ((column as ExcelDerivedField).variableName) {
                // Variable name column is valid
            } else {
                throw new Error(`Column ${key} must specify either 'column' or 'variableName'`);
            }
        });

        if (config.numberOfRowsToSkip === undefined || config.numberOfRowsToSkip < 0) {
            throw new Error("Number of rows to skip must be specified and non-negative");
        }
    } else if (config.type === "processor") {
        if (!config.processor || typeof config.processor !== "function") {
            throw new Error("Processor function is required for processor type");
        }
    }
};

/**
 * Finds all matching configurations for a given filename.
 */
export const findAllMatchingConfigs = (
    filename: string,
    configs: ExcelExtractionConfig[],
): ExcelExtractionConfig[] => {
    const fileInfo = path.parse(filename);

    return configs.filter(config =>
        config.fileNameValidator(fileInfo.base) &&
        config.extension === fileInfo.ext.replace(".", ""),
    );
};

/**
 * Creates an async generator from Excel data.
 */
export async function* createExcelGenerator(
    data: Record<string, string | number | null>[],
): AsyncGenerator<Record<string, any>, void, unknown> {
    for (const row of data) {
        yield row;
    }
}
