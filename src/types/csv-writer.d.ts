declare module "csv-writer" {
    interface ObjectHeaderItem {
        id: string;
        title: string;
    }

    interface ObjectCsvWriterParams {
        path: string;
        header: ObjectHeaderItem[];
        fieldDelimiter?: string;
        recordDelimiter?: string;
        headerIdDelimiter?: string;
        alwaysQuote?: boolean;
        encoding?: string;
        append?: boolean;
    }

    interface CsvWriter {
        writeRecords(records: any[]): Promise<void>;
    }

    export function createObjectCsvWriter(params: ObjectCsvWriterParams): CsvWriter;
}
