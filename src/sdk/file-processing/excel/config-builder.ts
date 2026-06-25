import { WorkBook } from "xlsx";
import { ReplicationMethod } from "../../models/replication";
import {
    ExcelExtractionConfig,
    ExcelSingleSheetExtractionConfig,
    ExcelCustomExtractorConfig,
    ExcelFieldSpec,
} from "../types";

/**
 * Builder pattern for creating Excel configurations.
 *
 * Sensible defaults:
 * - fileNameValidator: accepts all files
 * - fileNameVariablesExtractor: extracts nothing
 * - replicationMethod: FULL_TABLE
 */
export class ExcelExtractionConfigBuilder {
    private config: Partial<ExcelExtractionConfig> = {
        fileNameValidator: () => true,
        fileNameVariablesExtractor: () => ({}),
        replicationMethod: ReplicationMethod.FULL_TABLE,
    };

    static create(): ExcelExtractionConfigBuilder {
        return new ExcelExtractionConfigBuilder();
    }

    extension(ext: string): ExcelExtractionConfigBuilder {
        this.config.extension = ext;
        return this;
    }

    tableName(name: string | ((fileName: string, workbook?: WorkBook, variables?: { [key: string]: string | undefined }) => string)): ExcelExtractionConfigBuilder {
        this.config.tableName = name;
        return this;
    }

    fileValidator(validator: (filename: string) => boolean): ExcelExtractionConfigBuilder {
        this.config.fileNameValidator = validator;
        return this;
    }

    variablesExtractor(extractor: (filename: string, workbook?: WorkBook) => { [key: string]: string | undefined }): ExcelExtractionConfigBuilder {
        this.config.fileNameVariablesExtractor = extractor;
        return this;
    }

    replicationMethod(method: ReplicationMethod): ExcelExtractionConfigBuilder {
        this.config.replicationMethod = method;
        return this;
    }

    columns(cols: { [key: string]: ExcelFieldSpec }): ExcelExtractionConfigBuilder {
        if (this.config.type === "single-sheet-extraction") {
            (this.config as ExcelSingleSheetExtractionConfig).columns = cols;
        } else {
            throw new Error("Columns can only be set for single-sheet-extraction");
        }
        return this;
    }

    singleSheet(sheetName?: string, skipRows: number = 0): ExcelExtractionConfigBuilder {
        this.config.type = "single-sheet-extraction";
        if (sheetName !== undefined) {
            (this.config as ExcelSingleSheetExtractionConfig).sheetName = sheetName;
        }
        (this.config as ExcelSingleSheetExtractionConfig).numberOfRowsToSkip = skipRows;
        return this;
    }

    /**
     * Enable streaming (row-by-row) parsing of the sheet instead of loading the
     * whole workbook into memory. Required for very large sheets (close to or at
     * Excel's ~1M-row ceiling) that SheetJS cannot parse because the worksheet XML
     * exceeds Node's max string length. Only valid for single-sheet-extraction.
     */
    streaming(enabled: boolean = true): ExcelExtractionConfigBuilder {
        if (this.config.type !== "single-sheet-extraction") {
            throw new Error("streaming() can only be set for single-sheet-extraction; call singleSheet() first");
        }
        (this.config as ExcelSingleSheetExtractionConfig).streaming = enabled;
        return this;
    }

    processor(processorFn: (workbook: WorkBook) => Promise<Record<string, string>[]>): ExcelExtractionConfigBuilder {
        this.config.type = "processor";
        (this.config as ExcelCustomExtractorConfig).processor = processorFn;
        return this;
    }

    build(): ExcelExtractionConfig {
        if (!this.config.type) {
            throw new Error("Configuration type must be specified (singleSheet or processor)");
        }

        if (!this.config.extension) {
            throw new Error("Extension must be set");
        }

        if (!this.config.tableName) {
            throw new Error("Table name must be set");
        }

        if (!this.config.replicationMethod) {
            throw new Error("Replication method must be set");
        }

        if (typeof this.config.fileNameValidator !== "function") {
            throw new Error("fileNameValidator must be a function");
        }

        if (typeof this.config.fileNameVariablesExtractor !== "function") {
            throw new Error("fileNameVariablesExtractor must be a function");
        }

        if (this.config.type === "single-sheet-extraction") {
            const singleSheetConfig = this.config as Partial<ExcelSingleSheetExtractionConfig>;
            if (!singleSheetConfig.columns || Object.keys(singleSheetConfig.columns).length === 0) {
                throw new Error("Columns must be set with at least one column for single-sheet-extraction");
            }
        }

        if (this.config.type === "processor") {
            const processorConfig = this.config as Partial<ExcelCustomExtractorConfig>;
            if (typeof processorConfig.processor !== "function") {
                throw new Error("Processor function must be set for processor configs");
            }
        }

        return this.config as ExcelExtractionConfig;
    }
}
