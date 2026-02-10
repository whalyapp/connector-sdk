import XLSX from "xlsx";
import { Stream } from "../models/tap/stream";
import { Schema } from "../models/schema";
import { ReplicationMethod } from "../models/replication";
import { InputTapState } from "../models/state";
import { ITarget } from "../models/target/target";
import {
    FileStreamConfig,
    FileStreamEntry,
    FileFormat,
    ExcelExtractionConfig,
    CsvFileConfig,
} from "./types";
import { extractExcelRows } from "./excel/reader";
import { rowGeneratorFromCsv } from "./csv/reader";
import { excelFieldsToJsonSchema, csvFieldsToJsonSchema, extractPrimaryKeysFromExcelFields, extractPrimaryKeysFromCsvConfig } from "./schema-utils";

/**
 * FileStream bridges file processing (Excel/CSV) into the connector SDK pipeline.
 *
 * It extends Stream so it integrates with the standard Tap -> Stream -> Target flow.
 * Each FileStream reads one file with one config and yields records.
 */
export class FileStream extends Stream<Record<string, any>, FileStreamConfig> {
    private localFilePaths: string[];

    constructor(
        config: FileStreamConfig,
        localFilePath: string | string[],
        tapState: InputTapState,
        target: ITarget,
    ) {
        super(config, tapState, target);
        this.localFilePaths = Array.isArray(localFilePath) ? localFilePath : [localFilePath];

        // Set stream properties from config
        this.streamId = config.streamId;
        this.primaryKey = config.primaryKeys;
        this.replicationMethod = config.replicationMethod;
    }

    /**
     * Build JSON Schema from the file config's field definitions.
     */
    async getSchema(): Promise<Schema | undefined> {
        if (this.config.format === FileFormat.EXCEL) {
            const excelConfig = this.config.excel;
            if (excelConfig.type === "single-sheet-extraction") {
                const jsonSchema = excelFieldsToJsonSchema(excelConfig.columns);
                return { jsonSchema };
            }
            // For processor-type configs, schema must be inferred from first row at runtime.
            return undefined;
        }

        if (this.config.format === FileFormat.CSV) {
            const jsonSchema = csvFieldsToJsonSchema(this.config.csv.fields);
            return { jsonSchema };
        }

        throw new Error(`FileStream: No valid format config for stream ${this.streamId}`);
    }

    /**
     * Yield records from all file(s).
     * When multiple file paths are provided, records are yielded sequentially from each file.
     */
    async *_getRecords(): AsyncIterable<Record<string, any>> {
        for (const filePath of this.localFilePaths) {
            if (this.config.format === FileFormat.EXCEL) {
                const data = await extractExcelRows(filePath, this.config.excel);
                for (const row of data) {
                    yield row;
                }
            } else if (this.config.format === FileFormat.CSV) {
                yield* rowGeneratorFromCsv(filePath, this.config.csv);
            } else {
                throw new Error(`FileStream: Unsupported format for stream ${this.streamId}`);
            }
        }
    }
}

/**
 * Create a FileStreamConfig from an ExcelExtractionConfig.
 * Handles both single-sheet-extraction and processor config types.
 *
 * For single-sheet configs, primary keys are extracted from column definitions.
 * For processor configs, primary keys default to an empty array.
 *
 * @param excelConfig - The Excel extraction config (single-sheet or processor)
 * @param fileName - The base filename (used for variable extraction and table name resolution)
 * @param localFilePath - Optional local file path; required for processor configs with dynamic table names
 */
export function createExcelStreamConfig(
    excelConfig: ExcelExtractionConfig,
    fileName: string,
    localFilePath?: string,
): FileStreamConfig {
    if (excelConfig.type === "single-sheet-extraction") {
        const primaryKeys = extractPrimaryKeysFromExcelFields(excelConfig.columns);

        let tableName: string;
        if (typeof excelConfig.tableName === "function") {
            const variables = excelConfig.fileNameVariablesExtractor(fileName);
            tableName = excelConfig.tableName(fileName, undefined, variables);
        } else {
            tableName = excelConfig.tableName;
        }

        return {
            format: FileFormat.EXCEL,
            streamId: tableName,
            replicationMethod: excelConfig.replicationMethod,
            primaryKeys,
            excel: excelConfig,
        };
    }

    // Processor config
    let tableName: string;
    if (typeof excelConfig.tableName === "function") {
        if (!localFilePath) {
            throw new Error("localFilePath is required for processor configs with dynamic table names");
        }
        const workbook = XLSX.readFile(localFilePath, { dense: true });
        const variables = excelConfig.fileNameVariablesExtractor(fileName, workbook);
        tableName = excelConfig.tableName(fileName, workbook, variables);
    } else {
        tableName = excelConfig.tableName;
    }

    return {
        format: FileFormat.EXCEL,
        streamId: tableName,
        replicationMethod: excelConfig.replicationMethod,
        primaryKeys: [],
        excel: excelConfig,
    };
}

/**
 * Create a FileStreamConfig from a CsvFileConfig.
 *
 * By default, uses FULL_TABLE replication and extracts all field keys as composite primary keys.
 * Override via the options parameter.
 *
 * @param streamId - The stream/table name
 * @param csvConfig - The CSV file configuration
 * @param options - Optional overrides for replicationMethod and primaryKeys
 */
export function createCsvStreamConfig(
    streamId: string,
    csvConfig: CsvFileConfig,
    options?: {
        replicationMethod?: ReplicationMethod;
        primaryKeys?: string[];
    },
): FileStreamConfig {
    return {
        format: FileFormat.CSV,
        streamId,
        replicationMethod: options?.replicationMethod ?? ReplicationMethod.FULL_TABLE,
        primaryKeys: options?.primaryKeys ?? extractPrimaryKeysFromCsvConfig(csvConfig.fields),
        csv: csvConfig,
    };
}

/**
 * Process an array of FileStreamEntry sequentially, then signal completion to the target.
 *
 * This is the recommended pattern for SFTP and similar multi-file ingestion flows
 * where FileTap isn't needed.
 *
 * @param entries - Array of { config, filePath } pairs
 * @param tapState - The tap state (typically `{ bookmarks: {} }`)
 * @param target - The target (e.g. BigQueryTarget)
 */
export async function processFileStreams(
    entries: FileStreamEntry[],
    tapState: InputTapState,
    target: ITarget,
): Promise<void> {
    for (const entry of entries) {
        const stream = new FileStream(entry.config, entry.filePath, tapState, target);
        await stream.sync();
    }
    await target.complete();
}
