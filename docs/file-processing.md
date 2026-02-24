# File Processing Guide

The file processing module lets you build connectors that ingest Excel and CSV files into the Tap &rarr; Stream &rarr; Target pipeline.

## Table of Contents

- [Excel File Import](#excel-file-import)
- [Excel with Derived Fields](#excel-with-derived-fields)
- [Excel with Custom Processor](#excel-with-custom-processor)
- [Excel Config Builder](#excel-config-builder)
- [CSV File Import](#csv-file-import)
- [CSV Writing Utilities](#csv-writing-utilities)
- [File Patterns & Variable Extractors](#file-patterns--variable-extractors)
- [FileTap (Multi-Stream Orchestration)](#filetap-multi-stream-orchestration)
- [Services](#services)
  - [Cloud Storage (GCS)](#cloud-storage-gcs)
  - [SFTP](#sftp)
  - [ZIP / Archive Extraction](#zip--archive-extraction)
- [Full Example: GCS Excel Import Pipeline](#full-example-gcs-excel-import-pipeline)
- [Excel Utility Functions](#excel-utility-functions)

---

## Excel File Import

Define column mappings and use `FileStream` to extract data from Excel files into your target.

```typescript
import {
  ExcelSingleSheetExtractionConfig,
  FilePatterns,
  VariableExtractors,
  ReplicationMethod,
  createExcelStreamConfig,
  processFileStreams,
} from "@whaly/connector-sdk";

// 1. Define the Excel extraction config
const config: ExcelSingleSheetExtractionConfig = {
  type: "single-sheet-extraction",
  extension: "xlsx",
  tableName: "points_de_vente",
  sheetName: "Sheet1",
  numberOfRowsToSkip: 1, // skip header row
  replicationMethod: ReplicationMethod.FULL_TABLE,
  fileNameValidator: FilePatterns.startsWith("pdv"),
  fileNameVariablesExtractor: VariableExtractors.filename(),
  columns: {
    store_id:    { type: "STRING", column: "A", primaryKey: true },
    store_name:  { type: "STRING", column: "B" },
    city:        { type: "STRING", column: "C" },
    revenue:     { type: "FLOAT",  column: "D" },
    last_update: { type: "TIMESTAMP", column: "E" },
  },
};

// 2. Build a stream config from the extraction config
const streamConfig = createExcelStreamConfig(config, "pdv_export.xlsx");

// 3. Process the file into the target
await processFileStreams(
  [{ config: streamConfig, filePath: "/tmp/pdv_export.xlsx" }],
  { bookmarks: {} },
  target,
);
```

### Column Types

Each column specifies a `type` that maps to JSON Schema:

| `FieldType` | JSON Schema |
|---|---|
| `"STRING"` | `["null", "string"]` |
| `"FLOAT"` | `["null", "number"]` |
| `"TIMESTAMP"` | `["null", "string"]` with `format: "date-time"` |

### Config Fields

| Field | Description |
|---|---|
| `type` | `"single-sheet-extraction"` for column mapping |
| `extension` | File extension without dot (`"xlsx"`, `"xlsm"`, `"csv"`) |
| `tableName` | Output table name (string or function) |
| `sheetName` | Excel sheet to read (defaults to first sheet) |
| `numberOfRowsToSkip` | Number of header/metadata rows to skip |
| `replicationMethod` | `ReplicationMethod.FULL_TABLE` or `ReplicationMethod.INCREMENTAL` |
| `fileNameValidator` | Function that returns true if a filename matches this config |
| `fileNameVariablesExtractor` | Function that extracts variables from a filename/workbook |
| `columns` | Field mapping: output key &rarr; `ExcelSourceColumn` or `ExcelDerivedField` |

---

## Excel with Derived Fields

Extract variables from filenames or workbook metadata and inject them as columns:

```typescript
import {
  ExcelSingleSheetExtractionConfig,
  VariableExtractors,
  ReplicationMethod,
  excelRowToIndex,
  excelColumnToIndex,
} from "@whaly/connector-sdk";

const config: ExcelSingleSheetExtractionConfig = {
  type: "single-sheet-extraction",
  extension: "xlsm",
  tableName: "sales_report",
  sheetName: "DATA",
  numberOfRowsToSkip: 18,
  replicationMethod: ReplicationMethod.FULL_TABLE,

  // Validate filename pattern
  fileNameValidator: (fileName) =>
    fileName.toLowerCase().startsWith("sales_"),

  // Extract a variable from the workbook itself (e.g. a "Config" sheet)
  fileNameVariablesExtractor: (fileName, workbook) => {
    const configSheet = workbook?.Sheets["Config"]?.["!data"];
    return {
      period: configSheet?.[excelRowToIndex(24)]?.[excelColumnToIndex("F")]?.v,
    };
  },

  columns: {
    // Derived field: value comes from the extracted variable, not a cell
    period:    { variableName: "period", type: "STRING", primaryKey: true },
    // Source columns: value comes from Excel cells
    product:   { type: "STRING", column: "A", primaryKey: true },
    quantity:  { type: "FLOAT",  column: "B" },
    amount:    { type: "FLOAT",  column: "C" },
  },
};
```

A derived field uses `variableName` instead of `column`. The value is looked up from the object returned by `fileNameVariablesExtractor`.

---

## Excel with Custom Processor

For complex workbooks that don't fit the single-sheet model, use a custom processor:

```typescript
import {
  ExcelCustomExtractorConfig,
  ReplicationMethod,
  FilePatterns,
  VariableExtractors,
} from "@whaly/connector-sdk";

const config: ExcelCustomExtractorConfig = {
  type: "processor",
  extension: "xlsx",
  tableName: "custom_report",
  replicationMethod: ReplicationMethod.FULL_TABLE,
  fileNameValidator: FilePatterns.regex(/^REPORT_\d{4}/i),
  fileNameVariablesExtractor: VariableExtractors.filename(),

  // Full control over workbook parsing
  processor: async (workbook) => {
    const sheet = workbook.Sheets["Summary"];
    const data = sheet?.["!data"] ?? [];
    return data.slice(3).map((row) => ({
      category: String(row?.[0]?.v ?? ""),
      total: String(row?.[1]?.v ?? ""),
    }));
  },
};
```

The processor receives the full `WorkBook` object (from the `xlsx` library, re-exported as `WorkBook` by the SDK) and must return `Record<string, string>[]`.

---

## Excel Config Builder

Use the fluent builder API for a more concise configuration:

```typescript
import {
  ExcelExtractionConfigBuilder,
  FilePatterns,
  VariableExtractors,
  ReplicationMethod,
} from "@whaly/connector-sdk";

const config = ExcelExtractionConfigBuilder.create()
  .extension("xlsx")
  .tableName("products")
  .singleSheet("Sheet1", 1) // sheet name, rows to skip
  .fileValidator(FilePatterns.startsWith("product"))
  .variablesExtractor(VariableExtractors.filename())
  .replicationMethod(ReplicationMethod.FULL_TABLE)
  .columns({
    product_id:   { type: "STRING", column: "A", primaryKey: true },
    product_name: { type: "STRING", column: "B" },
    price:        { type: "FLOAT",  column: "C" },
  })
  .build();
```

Builder methods:

| Method | Description |
|---|---|
| `extension(ext)` | Set the file extension |
| `tableName(name)` | Set the output table name (string or function) |
| `singleSheet(sheetName?, skipRows?)` | Configure single-sheet extraction mode |
| `processor(fn)` | Configure custom processor mode |
| `fileValidator(fn)` | Set filename validation function |
| `variablesExtractor(fn)` | Set variable extraction function |
| `replicationMethod(method)` | Set replication method |
| `columns(mapping)` | Set column mapping (single-sheet mode only) |
| `build()` | Returns the final `ExcelExtractionConfig` |

---

## CSV File Import

```typescript
import {
  CsvFileConfig,
  createCsvStreamConfig,
  processFileStreams,
  ReplicationMethod,
} from "@whaly/connector-sdk";

// 1. Define the CSV config
const csvConfig: CsvFileConfig = {
  separator: ";",
  encoding: "latin1", // supports any iconv-lite encoding
  addSyncedAtColumn: true,
  fields: {
    // Dict style: keys are CSV column headers, values define output mapping
    "Code Article": { key: "code_article", type: "STRING" },
    "Libellé":      { key: "libelle",      type: "STRING" },
    "Prix HT":      {
      key: "prix_ht",
      type: "FLOAT",
      valueTransformer: (val) => val?.replace(",", ".") ?? "",
    },
    "Date Maj": { key: "date_maj", type: "TIMESTAMP" },
  },
};

// 2. Build a stream config
const streamConfig = createCsvStreamConfig("articles", csvConfig, {
  replicationMethod: ReplicationMethod.FULL_TABLE,
  primaryKeys: ["code_article"],
});

// 3. Process
await processFileStreams(
  [{ config: streamConfig, filePath: "/tmp/articles.csv" }],
  { bookmarks: {} },
  target,
);
```

### CsvFileConfig Fields

| Field | Description |
|---|---|
| `separator` | Column delimiter (`","`, `";"`, `"\t"`, etc.) |
| `encoding` | Character encoding (defaults to UTF-8). Supports any [iconv-lite](https://github.com/ashtuchkin/iconv-lite) encoding (`"latin1"`, `"windows-1252"`, etc.) |
| `fields` | Dict-style or array-style field definitions (see below) |
| `addSyncedAtColumn` | When `true`, adds a `_wly_synced_at` timestamp column |

### Dict-Style Fields (named headers)

Keys are the CSV column headers. Use this when the CSV has a header row:

```typescript
fields: {
  "CSV Column Name": {
    key: "output_field_name",
    type: "STRING",
    valueTransformer: (val) => val?.trim() ?? "",  // optional
  },
}
```

### Array-Style Fields (positional)

Use this for headerless CSVs or when columns are identified by position:

```typescript
fields: [
  { key: "id",    type: "STRING" },
  { key: "name",  type: "STRING" },
  { key: "value", type: "FLOAT"  },
]
```

---

## CSV Writing Utilities

Write data back to CSV files when you need to produce output files:

```typescript
import { writeDataToCsv, writeGeneratorToCSV } from "@whaly/connector-sdk";

// Write an array of objects directly
await writeDataToCsv("/tmp/output.csv", [
  { id: "1", name: "Product A", price: "10.5" },
  { id: "2", name: "Product B", price: "20.0" },
]);

// Write from an async generator (batched in 10k rows, memory-efficient for large datasets)
const rowCount = await writeGeneratorToCSV(myAsyncGenerator, "/tmp/large_output.csv");
console.log(`Wrote ${rowCount} rows`);
```

---

## File Patterns & Variable Extractors

Utility classes for validating filenames and extracting variables from them.

### FilePatterns

```typescript
import { FilePatterns } from "@whaly/connector-sdk";

// Simple prefix matching (case-insensitive)
const isNielsenFile = FilePatterns.startsWith("nielsen_");

// Regex matching
const isExcel = FilePatterns.regex(/\.xlsx?$/i);

// Combine with AND / OR logic
const isNielsenExcel = FilePatterns.and(isNielsenFile, isExcel);
const isReport = FilePatterns.or(
  FilePatterns.startsWith("report_"),
  FilePatterns.startsWith("rpt_"),
);
```

### VariableExtractors

```typescript
import { VariableExtractors } from "@whaly/connector-sdk";

// Return the full filename as a variable
const filenameVar = VariableExtractors.filename();
// filenameVar("data.xlsx") => { fileName: "data.xlsx" }

// Extract named capture groups from a regex
const extractDate = VariableExtractors.regex(
  /^report_(?<year>\d{4})_(?<month>\d{2})/
);
// extractDate("report_2024_06_data.xlsx") => { year: "2024", month: "06" }

// Combine multiple extractors
const extractor = VariableExtractors.combine(
  VariableExtractors.filename(),
  extractDate,
);
// extractor("report_2024_06.xlsx") => { fileName: "report_2024_06.xlsx", year: "2024", month: "06" }
```

---

## FileTap (Multi-Stream Orchestration)

For connectors that process multiple file types in a single run, use `FileTap`:

```typescript
import {
  FileTap,
  createExcelStreamConfig,
  createCsvStreamConfig,
  GCSStateProvider,
  BigQueryTarget,
} from "@whaly/connector-sdk";

const target = new BigQueryTarget(bigqueryConfig);
const stateProvider = new GCSStateProvider(bucketName, statePath);

const fileTap = new FileTap(
  target,
  {}, // tap config
  stateProvider,
  [
    {
      config: createExcelStreamConfig(excelConfig, "sales.xlsx"),
      filePath: "/tmp/sales.xlsx",
    },
    {
      config: createCsvStreamConfig("inventory", csvConfig),
      filePath: "/tmp/inventory.csv",
    },
  ],
);

await fileTap.run();
```

When all streams share the same file path, use the convenience constructor:

```typescript
const fileTap = FileTap.fromConfigs(
  target,
  {},
  stateProvider,
  [streamConfig1, streamConfig2],
  "/tmp/shared_data.xlsx",
);
```

### FileTap vs processFileStreams

| | `FileTap` | `processFileStreams()` |
|---|---|---|
| Use case | Full Tap lifecycle with state management | Simple sequential file processing |
| State | Managed via `StateProvider` | Manual (`{ bookmarks: {} }`) |
| Target completion | Handled by Tap lifecycle | Called automatically after all entries |

---

## Services

### Cloud Storage (GCS)

Download files from GCS, track processed files with marker files, and upload results:

```typescript
import { CloudStorageService } from "@whaly/connector-sdk";

const storage = new CloudStorageService("my-bucket", "incoming/", {
  processedSuffix: ".processed",       // default
  supportedExtensions: [".xlsx", ".csv"],
});

// Get files that haven't been processed yet
const files = await storage.getUnprocessedFiles();

for (const file of files) {
  const fileName = file.split("/").pop()!;
  // Download to local tmp/
  const localPath = await storage.downloadFile(file, fileName);

  // ... process the file ...

  // Mark as processed (creates a .processed marker file)
  await storage.createMarkerFile(file);
}

// Upload results
await storage.uploadFile("/tmp/output.csv", "processed/output.csv");
```

#### How marker files work

When a file `incoming/data.xlsx` is processed, calling `createMarkerFile("incoming/data.xlsx")` creates a GCS object `incoming/data.xlsx.processed`. On the next run, `getUnprocessedFiles()` filters out any file that already has a corresponding marker.

### SFTP

Connect to remote servers and download files via SFTP:

```typescript
import { SftpClient, SftpConnectOptions } from "@whaly/connector-sdk";

const sftp = new SftpClient();

await sftp.connect({
  host: "sftp.example.com",
  port: 22,
  username: "user",
  password: "pass",
});

const fileList = await sftp.list("/remote/path");
await sftp.get("/remote/path/data.xlsx", "/tmp/data.xlsx");
await sftp.end();
```

### ZIP / Archive Extraction

```typescript
import { unzip } from "@whaly/connector-sdk";

// Supports zip, tar, gz, bz2
const outputDir = await unzip("/tmp/archive.zip", "/tmp/extracted");
```

---

## Full Example: GCS Excel Import Pipeline

A complete connector that downloads Excel files from GCS and processes them into BigQuery:

```typescript
import {
  CloudStorageService,
  ExcelSingleSheetExtractionConfig,
  FilePatterns,
  VariableExtractors,
  ReplicationMethod,
  createExcelStreamConfig,
  findAllMatchingConfigs,
  processFileStreams,
  BigQueryTarget,
} from "@whaly/connector-sdk";

const INPUT_BUCKET = process.env.INPUT_BUCKET_NAME!;

// Define one config per file type
const configs: ExcelSingleSheetExtractionConfig[] = [
  {
    type: "single-sheet-extraction",
    extension: "xlsx",
    tableName: "stores",
    sheetName: "Sheet1",
    numberOfRowsToSkip: 1,
    replicationMethod: ReplicationMethod.FULL_TABLE,
    fileNameValidator: FilePatterns.startsWith("pdv"),
    fileNameVariablesExtractor: VariableExtractors.filename(),
    columns: {
      store_id:   { type: "STRING", column: "A", primaryKey: true },
      store_name: { type: "STRING", column: "B" },
      city:       { type: "STRING", column: "C" },
    },
  },
  {
    type: "single-sheet-extraction",
    extension: "xlsx",
    tableName: "products",
    sheetName: "Sheet1",
    numberOfRowsToSkip: 1,
    replicationMethod: ReplicationMethod.FULL_TABLE,
    fileNameValidator: FilePatterns.startsWith("produit"),
    fileNameVariablesExtractor: VariableExtractors.filename(),
    columns: {
      product_id:   { type: "STRING", column: "A", primaryKey: true },
      product_name: { type: "STRING", column: "B" },
      ean:          { type: "STRING", column: "C" },
      price:        { type: "FLOAT",  column: "D" },
    },
  },
];

(async () => {
  const storage = new CloudStorageService(INPUT_BUCKET, "incoming/", {
    supportedExtensions: [".xlsx"],
  });
  const target = new BigQueryTarget(/* config */);

  const unprocessedFiles = await storage.getUnprocessedFiles();
  console.log("Files to process:", unprocessedFiles);

  for (const filePath of unprocessedFiles) {
    const fileName = filePath.split("/").pop()!;

    // findAllMatchingConfigs checks fileNameValidator + extension
    const matchingConfigs = findAllMatchingConfigs(fileName, configs);

    if (matchingConfigs.length === 0) {
      console.warn("No matching config for:", fileName);
      continue;
    }

    const localPath = await storage.downloadFile(filePath, fileName);

    const entries = matchingConfigs.map((cfg) => ({
      config: createExcelStreamConfig(cfg, fileName, localPath),
      filePath: localPath,
    }));

    await processFileStreams(entries, { bookmarks: {} }, target);
    await storage.createMarkerFile(filePath);
  }
})();
```

---

## Excel Utility Functions

Low-level helpers for working with Excel cell references:

```typescript
import {
  excelColumnToIndex,
  indexToExcelColumn,
  excelRowToIndex,
  indexToExcelRow,
  parseCellReference,
  createCellReference,
} from "@whaly/connector-sdk";

excelColumnToIndex("A");   // 0
excelColumnToIndex("Z");   // 25
excelColumnToIndex("AA");  // 26

indexToExcelColumn(0);     // "A"
indexToExcelColumn(26);    // "AA"

parseCellReference("B3");  // { columnIndex: 1, rowIndex: 2 }
createCellReference(1, 2); // "B3"

excelRowToIndex(1);        // 0 (Excel rows are 1-based)
indexToExcelRow(0);        // 1
```

These are useful inside `fileNameVariablesExtractor` when reading cells from metadata sheets.
