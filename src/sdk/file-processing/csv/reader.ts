import csv from "csv-parser";
import { createReadStream, ReadStream as FsReadStream } from "fs";
import { format } from "util";
import { CsvFileConfig, CsvFieldsArrayConfig, CsvFieldsDictConfig } from "../types";
import { Readable, Transform } from "stream";
import * as iconv from "iconv-lite";

const logPrefix = "[csvReader]";

const createStripBomTransform = () => {
    let isFirstChunk = true;
    return new Transform({
        transform(chunk, encoding, callback) {
            if (isFirstChunk) {
                isFirstChunk = false;
                if (chunk.length >= 3 && chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
                    chunk = chunk.slice(3);
                }
            }
            callback(null, chunk);
        },
    });
};

const getStringHexInfo = (str: string) => {
    const bytes = Buffer.from(str, "utf8");
    const hex = bytes.toString("hex").match(/.{2}/g)?.join(" ") || "";
    return {
        original: str,
        length: str.length,
        hex: hex,
        trimmed: str.trim(),
    };
};

const formatHexComparison = (expected: string, actual: string) => {
    const expectedInfo = getStringHexInfo(expected);
    const actualInfo = getStringHexInfo(actual);

    return `\nExpected: "${expected}" (${expectedInfo.length} chars) [${expectedInfo.hex}]\nActual:   "${actual}" (${actualInfo.length} chars) [${actualInfo.hex}]`;
};

/**
 * Async generator that yields parsed rows from a CSV file.
 * Supports custom separators, encoding, BOM stripping, and field transformers.
 */
export async function* rowGeneratorFromCsv(
    path: string,
    fileConfig: CsvFileConfig,
): AsyncGenerator<Record<string, any>> {
    const isGeneratorConfigArray = Array.isArray(fileConfig.fields);
    // Cache config keys once — avoids re-enumerating the same static object on every row
    const configKeys = isGeneratorConfigArray ? [] : Object.keys(fileConfig.fields);
    const csvOptions: Record<string, any> = { separator: fileConfig.separator };
    if (isGeneratorConfigArray) {
        csvOptions.headers = false;
    }
    const csvStream = csv(csvOptions);

    let initialReadStream: FsReadStream;
    let finalInputStream: NodeJS.ReadableStream;

    const encodingToUse = fileConfig.encoding ? fileConfig.encoding.toLowerCase() : null;

    if (encodingToUse && encodingToUse !== "utf-8" && encodingToUse !== "utf8" && iconv.encodingExists(encodingToUse)) {
        initialReadStream = createReadStream(path);
        finalInputStream = initialReadStream.pipe(iconv.decodeStream(encodingToUse));
    } else {
        initialReadStream = createReadStream(path);
        finalInputStream = initialReadStream.pipe(createStripBomTransform());
    }

    finalInputStream.pipe(csvStream);

    try {
        for await (const row of Readable.from(csvStream)) {
            if (!isGeneratorConfigArray) {
                const rowData: Record<string, any> = {};
                for (const key of configKeys) {
                    const keyGenerator = (fileConfig.fields as CsvFieldsDictConfig)[key.trim()];
                    if (!keyGenerator) continue;
                    const rawValue = keyGenerator.valueTransformer
                        ? keyGenerator.valueTransformer(row[key])
                        : row[key];
                    rowData[keyGenerator.key] = rawValue === "" ? null : rawValue;
                }
                yield rowData;
            } else {
                const rowKeys = Object.keys(row);
                const rowData: Record<string, any> = {};
                for (let i = 0; i < rowKeys.length; i++) {
                    const keyGenerator = (fileConfig.fields as CsvFieldsArrayConfig)[i];
                    if (!keyGenerator) continue;
                    const rawValue = keyGenerator.valueTransformer
                        ? keyGenerator.valueTransformer(row[i])
                        : row[i];
                    rowData[keyGenerator.key] = rawValue === "" ? null : rawValue;
                }
                yield rowData;
            }
        }
    } finally {
        initialReadStream.destroy();
    }
}

/**
 * Counts data rows in a CSV file by scanning for newline bytes.
 * Subtracts 1 for the header row. Fast: no CSV parsing required.
 */
export async function countCsvLines(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        let newlines = 0;
        createReadStream(filePath)
            .on("data", (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                for (let i = 0; i < buf.length; i++) {
                    if (buf[i] === 0x0a) newlines++;
                }
            })
            .on("end", () => resolve(Math.max(0, newlines - 1)))
            .on("error", reject);
    });
}

/**
 * Validates CSV header row against expected configuration.
 */
export const checkCsvHeaderRow = async (
    path: string,
    fileConfig: CsvFileConfig,
): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        const colsWithParsingConfig = Object.keys(fileConfig.fields)
            .map(key => key.trim());

        console.debug(`${logPrefix} CSV Expected columns:`, colsWithParsingConfig.map(col => {
            const info = getStringHexInfo(col);
            return `"${info.original}" [${info.hex}]`;
        }));

        const isGeneratorConfigArray = Array.isArray(fileConfig.fields);
        const csvOptions2: Record<string, any> = { separator: fileConfig.separator };
        if (isGeneratorConfigArray) {
            csvOptions2.headers = false;
        }
        const csvStream = csv(csvOptions2);

        let initialReadStream: FsReadStream;
        let finalInputStream: NodeJS.ReadableStream;
        const encodingToUse = fileConfig.encoding ? fileConfig.encoding.toLowerCase() : null;

        if (
            encodingToUse
            && encodingToUse !== "utf-8"
            && encodingToUse !== "utf8"
            && iconv.encodingExists(encodingToUse)
        ) {
            initialReadStream = createReadStream(path);
            finalInputStream = initialReadStream.pipe(iconv.decodeStream(encodingToUse));
        } else {
            initialReadStream = createReadStream(path);
            finalInputStream = initialReadStream.pipe(createStripBomTransform());
        }

        let isFirstLine = true;

        finalInputStream
            .pipe(csvStream)
            .on("data", (row: any) => {
                if (isFirstLine) {
                    let headers: string[] = [];
                    if (isGeneratorConfigArray) {
                        headers = (Object.values(row) as string[]).filter(r => !!r);
                    } else {
                        headers = (Object.keys(row) as string[]).filter(r => !!r);
                    }

                    console.debug(`${logPrefix} CSV Detected headers:`, headers.map((h, idx) => {
                        const info = getStringHexInfo(h);
                        return `[${idx}]: "${info.original}" [${info.hex}]`;
                    }));

                    if (isGeneratorConfigArray) {
                        colsWithParsingConfig.forEach((col, i) => {
                            if (col !== headers[i]) {
                                const hexComparison = formatHexComparison(col, headers[i] || "<undefined>");
                                console.error(`${logPrefix} CSV Header Mismatch:${hexComparison}`);

                                throw new Error(format(
                                    `CSV header mismatch at position %s: expected '%s' but got '%s' in file %s`,
                                    i,
                                    col,
                                    headers[i] || "<undefined>",
                                    path,
                                ));
                            }
                        });
                    } else {
                        colsWithParsingConfig.forEach((col) => {
                            if (!headers.includes(col)) {
                                const colInfo = getStringHexInfo(col);
                                console.error(`CSV Missing column: "${col}" [${colInfo.hex}]`);
                                console.error(`Available headers:`, headers.map(h => `"${h}" [${getStringHexInfo(h).hex}]`));

                                const trimmedMatch = headers.find(h => h.trim() === col.trim());
                                if (trimmedMatch) {
                                    console.error(`Potential trimmed match: "${trimmedMatch}" [${getStringHexInfo(trimmedMatch).hex}]`);
                                }

                                throw new Error(format(
                                    `CSV missing expected column '%s' in file: %s`,
                                    col,
                                    path,
                                ));
                            }
                        });
                    }
                    isFirstLine = false;
                } else {
                    initialReadStream.destroy();
                }
            })
            .on("error", (error: Error) => {
                reject(new Error(`Error processing CSV file: ${error.message}`));
            });
        initialReadStream.on("close", () => {
            resolve();
        });
    });
};
