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
 */
export class ExcelExtractionConfigBuilder {
    private config: Partial<ExcelExtractionConfig> = {};

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

    processor(processorFn: (workbook: WorkBook) => Promise<Record<string, string>[]>): ExcelExtractionConfigBuilder {
        this.config.type = "processor";
        (this.config as ExcelCustomExtractorConfig).processor = processorFn;
        return this;
    }

    build(): ExcelExtractionConfig {
        if (!this.config.type) {
            throw new Error("Configuration type must be specified (singleSheet or processor)");
        }

        return this.config as ExcelExtractionConfig;
    }
}
