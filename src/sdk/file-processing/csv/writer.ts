import { createObjectCsvWriter } from "csv-writer";
import { format } from "util";

const logPrefix = "[csvWriter]";

/**
 * Writes an array of objects directly to a CSV file.
 */
export const writeDataToCsv = async (
    fileName: string,
    data: any[],
): Promise<void> => {
    try {
        const firstRow = data[0];
        if (!firstRow) {
            console.log(`${logPrefix} No data to write to CSV file=%s`, fileName);
            return;
        }
        const csvWriter = createObjectCsvWriter({
            path: fileName,
            header: Object.keys(firstRow)
                .map(col => {
                    return { id: col, title: col };
                }),
        });
        await csvWriter.writeRecords(data);
        console.log(`${logPrefix} CSV file=%s written successfully`, fileName);
    } catch (err) {
        if (err instanceof Error) {
            throw new Error(format(`error while writing csv file=%s, err: %s`, fileName, err.message));
        }
        throw err;
    }
};

/**
 * Writes data from an async generator to CSV with batch writing (10k row batches).
 */
export const writeGeneratorToCSV = async (
    generator: AsyncGenerator,
    outputFileName: string,
): Promise<number> => {
    try {
        let rowCount = 0;

        const firstDataRow = (await generator.next()).value;
        if (!firstDataRow) {
            console.log(`${logPrefix} [%s] first data row of csv empty, skipping`, outputFileName);
            return 0;
        }

        console.log(`${logPrefix} [%s] inferring headers from first data row`, outputFileName);
        const headers = Object.keys(firstDataRow)
            .map(col => {
                return {
                    id: col,
                    title: col,
                };
            });

        const csvWriter = createObjectCsvWriter({
            path: outputFileName,
            header: headers,
            alwaysQuote: true,
        });

        console.log(`${logPrefix} [%s] writing csv`, outputFileName);
        let batch = [firstDataRow];
        for await (const data of generator) {
            batch.push(data);
            rowCount++;
            if (batch.length > 10_000) {
                try {
                    await csvWriter.writeRecords(batch as any[]);
                } catch (err) {
                    if (err instanceof Error) {
                        throw new Error(
                            format(
                                `error while writing batch to csv batch (first 3 records)=%j, err: %s`,
                                batch.slice(0, 3),
                                err.message,
                            ),
                        );
                    }
                    throw err;
                }
                batch = [];
            }
        }
        await csvWriter.writeRecords(batch as any[]);
        console.log(`${logPrefix} [%s] csv written successfully with %d rows`, outputFileName, rowCount);
        return rowCount;
    } catch (err) {
        if (err instanceof Error) {
            throw new Error(format(`error while writing csv file=%s, err: %s`, outputFileName, err.message));
        }
        throw err;
    }
};
