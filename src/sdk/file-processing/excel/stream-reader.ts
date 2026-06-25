import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { Readable, PassThrough } from "stream";
import { StringDecoder } from "string_decoder";
import {
    ExcelSingleSheetExtractionConfig,
    ExcelSourceColumn,
    ExcelDerivedField,
} from "../types";
import { coerceCellValue } from "../schema-utils";
import { excelColumnToIndex, parseCellReference } from "./reader";

const logPrefix = "[excelStreamReader]";

/**
 * A raw worksheet row: its 1-based sheet row number and its cell values keyed by
 * zero-based column index (sparse — only populated columns are present).
 */
interface RawRow {
    num: number;
    cells: (string | number | boolean | null)[];
}

interface ZipHandle {
    zipfile: yauzl.ZipFile;
    entries: Map<string, yauzl.Entry>;
}

/**
 * Opens an xlsx (zip) file and indexes every entry by name. yauzl reads the
 * central directory, so entries are available for random access regardless of
 * their physical order in the archive — unlike streaming readers that depend on
 * `workbook.xml` appearing before the worksheets.
 */
const openZip = (filePath: string): Promise<ZipHandle> =>
    new Promise((resolve, reject) => {
        // autoClose:false so the handle stays open for random-access reads after
        // we have walked the central directory to index every entry.
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err || !zipfile) {
                reject(err ?? new Error("Failed to open xlsx archive"));
                return;
            }
            const entries = new Map<string, yauzl.Entry>();
            zipfile.on("entry", entry => {
                entries.set(entry.fileName, entry);
                zipfile.readEntry();
            });
            zipfile.on("end", () => resolve({ zipfile, entries }));
            zipfile.on("error", reject);
            zipfile.readEntry();
        });
    });

const entryReadStream = (zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> =>
    new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
                reject(err ?? new Error(`Failed to read entry ${entry.fileName}`));
                return;
            }
            // yauzl's read streams don't support async iteration (`for await`)
            // reliably — they only pump in flowing mode. Piping through a
            // PassThrough yields a stream that iterates correctly.
            const passthrough = new PassThrough();
            stream.on("error", e => passthrough.destroy(e));
            stream.pipe(passthrough);
            resolve(passthrough);
        });
    });

const readEntryToString = async (zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> => {
    const stream = await entryReadStream(zipfile, entry);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
};

/**
 * Resolves the worksheet entry for a sheet name (or the first sheet when no name
 * is given) by reading workbook.xml (sheet name -> relationship id) and
 * workbook.xml.rels (relationship id -> worksheet file).
 */
const resolveWorksheetEntry = async (
    zipfile: yauzl.ZipFile,
    entries: Map<string, yauzl.Entry>,
    sheetName: string | undefined,
): Promise<{ entry: yauzl.Entry; name: string } | null> => {
    const workbookEntry = entries.get("xl/workbook.xml");
    const relsEntry = entries.get("xl/_rels/workbook.xml.rels");
    if (!workbookEntry || !relsEntry) {
        throw new Error("Invalid xlsx: missing workbook.xml or workbook.xml.rels");
    }

    const sheets: { name: string; rid: string }[] = [];
    const workbookParser = new SaxesParser();
    workbookParser.on("opentag", tag => {
        if (tag.name === "sheet") {
            const name = tag.attributes["name"];
            const rid = tag.attributes["r:id"] ?? tag.attributes["id"];
            if (name !== undefined && rid !== undefined) {
                sheets.push({ name, rid });
            }
        }
    });
    workbookParser.write(await readEntryToString(zipfile, workbookEntry));
    workbookParser.close();

    const relTargets = new Map<string, string>();
    const relsParser = new SaxesParser();
    relsParser.on("opentag", tag => {
        if (tag.name === "Relationship") {
            const id = tag.attributes["Id"];
            const target = tag.attributes["Target"];
            if (id !== undefined && target !== undefined) {
                relTargets.set(id, target);
            }
        }
    });
    relsParser.write(await readEntryToString(zipfile, relsEntry));
    relsParser.close();

    const chosen = sheetName ? sheets.find(s => s.name === sheetName) : sheets[0];
    if (!chosen) {
        return null;
    }

    const target = relTargets.get(chosen.rid);
    if (!target) {
        return null;
    }

    // Relationship targets are usually relative to xl/ (e.g. "worksheets/sheet3.xml")
    // but may be absolute ("/xl/worksheets/sheet3.xml").
    const path = target.startsWith("/")
        ? target.replace(/^\//, "")
        : `xl/${target.replace(/^\.\//, "")}`;
    const entry = entries.get(path);
    if (!entry) {
        return null;
    }
    return { entry, name: chosen.name };
};

/**
 * Parses the (small, deduplicated) shared strings table into an array indexed by
 * shared-string id. Returns an empty array when the workbook stores strings
 * inline rather than in a shared table.
 */
const parseSharedStrings = async (
    zipfile: yauzl.ZipFile,
    entries: Map<string, yauzl.Entry>,
): Promise<string[]> => {
    const entry = entries.get("xl/sharedStrings.xml");
    if (!entry) {
        return [];
    }

    const strings: string[] = [];
    const parser = new SaxesParser();
    let current = "";
    let inSi = false;
    let capture = false;

    parser.on("opentag", tag => {
        if (tag.name === "si") {
            inSi = true;
            current = "";
        } else if (tag.name === "t" && inSi) {
            capture = true;
        }
    });
    parser.on("text", text => {
        if (capture) current += text;
    });
    parser.on("closetag", tag => {
        if (tag.name === "t") {
            capture = false;
        } else if (tag.name === "si") {
            strings.push(current);
            inSi = false;
        }
    });

    const stream = await entryReadStream(zipfile, entry);
    const decoder = new StringDecoder("utf8");
    for await (const chunk of stream) {
        parser.write(decoder.write(chunk as Buffer));
    }
    const tail = decoder.end();
    if (tail) parser.write(tail);
    parser.close();
    return strings;
};

/**
 * Resolves a single cell's value from its declared type, raw `<v>` text and any
 * inline-string text, mirroring the scalar that SheetJS would expose as `cell.v`.
 */
const resolveCellValue = (
    type: string | undefined,
    vText: string | undefined,
    inlineText: string,
    hasInline: boolean,
    sharedStrings: string[],
): string | number | boolean | null => {
    if (type === "inlineStr") {
        return hasInline ? inlineText : null;
    }
    if (vText === undefined) {
        return null;
    }
    switch (type) {
        case "s": {
            const idx = Number(vText);
            return Number.isNaN(idx) ? null : sharedStrings[idx] ?? null;
        }
        case "str":
            return vText;
        case "b":
            return vText === "1";
        case "e":
            return null;
        case "d":
            return vText;
        default: {
            if (vText === "") return null;
            const num = Number(vText);
            return Number.isNaN(num) ? vText : num;
        }
    }
};

/**
 * Streams the rows of a worksheet XML entry, yielding each as a RawRow. The SAX
 * parser pushes completed rows into a buffer that is drained between stream
 * chunks, giving natural backpressure and bounded memory.
 */
async function* streamRawRows(stream: Readable, sharedStrings: string[]): AsyncGenerator<RawRow> {
    const parser = new SaxesParser();
    const pending: RawRow[] = [];
    let parseError: Error | null = null;

    let currentRow: RawRow | null = null;
    let cellColIndex = 0;
    let cellType: string | undefined;
    let cellV: string | undefined;
    let inlineText = "";
    let hasInline = false;
    let capture: "v" | "t" | null = null;

    parser.on("error", err => {
        parseError = err;
    });
    parser.on("opentag", tag => {
        switch (tag.name) {
            case "row":
                currentRow = { num: Number(tag.attributes["r"] ?? 0), cells: [] };
                break;
            case "c": {
                const ref = tag.attributes["r"];
                cellColIndex = ref ? parseCellReference(ref).columnIndex : 0;
                cellType = tag.attributes["t"];
                cellV = undefined;
                inlineText = "";
                hasInline = false;
                break;
            }
            case "v":
                capture = "v";
                cellV = "";
                break;
            case "t":
                capture = "t";
                hasInline = true;
                break;
        }
    });
    parser.on("text", text => {
        if (capture === "v") {
            cellV += text;
        } else if (capture === "t") {
            inlineText += text;
        }
    });
    parser.on("closetag", tag => {
        switch (tag.name) {
            case "v":
            case "t":
                capture = null;
                break;
            case "c":
                if (currentRow) {
                    currentRow.cells[cellColIndex] = resolveCellValue(
                        cellType,
                        cellV,
                        inlineText,
                        hasInline,
                        sharedStrings,
                    );
                }
                break;
            case "row":
                if (currentRow) {
                    pending.push(currentRow);
                    currentRow = null;
                }
                break;
        }
    });

    const decoder = new StringDecoder("utf8");
    for await (const chunk of stream) {
        parser.write(decoder.write(chunk as Buffer));
        if (parseError) throw parseError;
        while (pending.length) {
            yield pending.shift()!;
        }
    }
    const tail = decoder.end();
    if (tail) parser.write(tail);
    parser.close();
    if (parseError) throw parseError;
    while (pending.length) {
        yield pending.shift()!;
    }
}

/**
 * Async generator that yields parsed rows from a single Excel sheet using a
 * streaming reader. Memory stays bounded regardless of sheet size, so it handles
 * sheets too large for SheetJS (whose per-sheet XML string hits Node's ~0.5 GB
 * max-string-length limit around the 1M-row Excel ceiling).
 *
 * Replicates the semantics of the in-memory `extractSingleSheetRows`:
 *  - skips the first `numberOfRowsToSkip` sheet rows,
 *  - stops at the first data row whose lowest configured source column is empty,
 *  - coerces each cell to its declared FieldType,
 *  - resolves derived (variableName) fields from the filename variables.
 */
export async function* rowGeneratorFromExcelSheet(
    filePath: string,
    conf: ExcelSingleSheetExtractionConfig,
): AsyncGenerator<Record<string, string | number | null>> {
    console.log("%s Streaming single sheet rows from file: %s (sheet: %s)", logPrefix, filePath, conf.sheetName || "first");

    // Streaming readers don't expose a SheetJS WorkBook; variable extractors that
    // only depend on the filename keep working (matches createExcelStreamConfig).
    const variables = conf.fileNameVariablesExtractor(filePath);

    // Lowest configured source-column index: when this column is empty on a data
    // row we treat it as the end of the table (same rule as the in-memory reader).
    const minColumnIndex = Object.values(conf.columns).reduce((min, column) => {
        return (column as ExcelSourceColumn).column
            ? Math.min(min, excelColumnToIndex((column as ExcelSourceColumn).column))
            : min;
    }, Number.MAX_SAFE_INTEGER);

    const columnEntries = Object.entries(conf.columns);

    const { zipfile, entries } = await openZip(filePath);
    let emitted = 0;
    try {
        const resolved = await resolveWorksheetEntry(zipfile, entries, conf.sheetName);
        if (!resolved) {
            throw new Error(`Sheet ${conf.sheetName} not found in workbook`);
        }

        const sharedStrings = await parseSharedStrings(zipfile, entries);
        const worksheetStream = await entryReadStream(zipfile, resolved.entry);

        for await (const raw of streamRawRows(worksheetStream, sharedStrings)) {
            if (raw.num <= conf.numberOfRowsToSkip) {
                continue;
            }

            // Stop at the first empty value in the lowest source column.
            if (minColumnIndex !== Number.MAX_SAFE_INTEGER && !raw.cells[minColumnIndex]) {
                console.log(
                    "%s stopping processing because of empty value in the first data column (idx: %s)",
                    logPrefix,
                    minColumnIndex,
                );
                break;
            }

            const rowData: Record<string, string | number | null> = {};
            for (const [key, column] of columnEntries) {
                if ((column as ExcelDerivedField).variableName) {
                    if (!variables) {
                        throw new Error(`No variables extracted from filename, cannot extract derived field ${key}`);
                    }
                    rowData[key] = variables[(column as ExcelDerivedField).variableName] ?? null;
                } else {
                    const colIndex = excelColumnToIndex((column as ExcelSourceColumn).column);
                    rowData[key] = coerceCellValue(raw.cells[colIndex] ?? null, (column as ExcelSourceColumn).type);
                }
            }

            emitted++;
            yield rowData;
        }
    } finally {
        try {
            zipfile.close();
        } catch {
            // ignore cleanup errors
        }
    }

    console.log("%s Streamed %s rows from sheet %s", logPrefix, emitted, conf.sheetName || "first");
}
