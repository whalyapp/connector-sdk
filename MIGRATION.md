# Migration Guide: 0.2.0 → 0.3.0

This guide covers adopting the new file processing module introduced in 0.3.0. There are no breaking changes — all additions are backwards-compatible.

## New: File Processing Module

### Replacing custom Excel/CSV parsing with the SDK

If your connector manually reads Excel files with XLSX and writes CSV output, you can now use the SDK's built-in file processing pipeline.

**Before (0.2.0 — manual approach):**
```typescript
import * as XLSX from "xlsx";
import { StorageService } from "./services/bucket";
import { writeGeneratorToCSV } from "./services/csvWriter";

const storage = new StorageService(bucketName, inputPath);
const files = await storage.getUnprocessedFiles();

for (const file of files) {
  const localPath = await storage.downloadFile(file, fileName);
  const workbook = XLSX.readFile(localPath);
  const sheet = workbook.Sheets["Sheet1"];
  // ... manual row parsing, header validation, CSV writing ...
  await writeGeneratorToCSV(generator, outputPath);
  await outputStorage.uploadFile(outputPath, destPath);
  await storage.createMarkerFile(file);
}
```

**After (0.3.0 — using the SDK):**
```typescript
import {
  CloudStorageService,
  createExcelStreamConfig,
  findAllMatchingConfigs,
  processFileStreams,
  FilePatterns,
  VariableExtractors,
  ReplicationMethod,
} from "@whaly/connector-sdk";

const config = {
  type: "single-sheet-extraction" as const,
  extension: "xlsx",
  tableName: "my_table",
  sheetName: "Sheet1",
  numberOfRowsToSkip: 1,
  replicationMethod: ReplicationMethod.FULL_TABLE,
  fileNameValidator: FilePatterns.startsWith("my_prefix"),
  fileNameVariablesExtractor: VariableExtractors.filename(),
  columns: {
    id:   { type: "STRING" as const, column: "A", primaryKey: true },
    name: { type: "STRING" as const, column: "B" },
  },
};

const storage = new CloudStorageService(bucketName, inputPath, {
  supportedExtensions: [".xlsx"],
});

const files = await storage.getUnprocessedFiles();

for (const filePath of files) {
  const fileName = filePath.split("/").pop()!;
  const localPath = await storage.downloadFile(filePath, fileName);

  const streamConfig = createExcelStreamConfig(config, fileName, localPath);
  await processFileStreams(
    [{ config: streamConfig, filePath: localPath }],
    { bookmarks: {} },
    target,
  );

  await storage.createMarkerFile(filePath);
}
```

### Replacing custom StorageService with CloudStorageService

The SDK now provides `CloudStorageService` which replaces custom bucket service implementations.

**Before (custom service):**
```typescript
import { StorageService } from "./services/bucket";
const storage = new StorageService(bucketName, path);
```

**After (SDK service):**
```typescript
import { CloudStorageService } from "@whaly/connector-sdk";
const storage = new CloudStorageService(bucketName, path, {
  supportedExtensions: [".xlsx", ".csv"],
});
```

The API is the same: `getUnprocessedFiles()`, `downloadFile()`, `uploadFile()`, `createMarkerFile()`.

### Using CSV fields instead of custom generators

**Before (custom generator objects):**
```typescript
const generator = {
  "Column Header": { key: "output_key", schemaType: "STRING" },
};
```

**After (SDK CsvFileConfig):**
```typescript
import { CsvFileConfig } from "@whaly/connector-sdk";

const csvConfig: CsvFileConfig = {
  separator: ";",
  encoding: "latin1",
  fields: {
    "Column Header": { key: "output_key", type: "STRING" },
  },
};
```

---

# Migration Guide: 0.1.1 → 0.2.0

This guide will help you migrate your code from version 0.1.1 to 0.2.0 of the connector SDK.

## Breaking Changes

### 1. Date Library: moment → dayjs

The SDK has migrated from `moment` to `dayjs` for date/time operations.

**Before (0.1.1):**
```typescript
import moment from "moment";
const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
```

**After (0.2.0):**
```typescript
import dayjs from "dayjs";
const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
```

**Action Required:**
- Update any imports from `moment` to `dayjs`
- Replace `moment()` calls with `dayjs()`
- Note: `dayjs` has a similar API to `moment` but is immutable by default

### 2. Removed Resolver System

The resolver system has been completely removed from the SDK.

**Before (0.1.1):**
```typescript
import { Resolver } from "@whaly/connector-sdk";
import { LocalFileResolver } from "@whaly/connector-sdk/resolvers/local-file";
```

**After (0.2.0):**
- Resolver functionality is no longer available

**Action Required:**
- Remove all imports related to resolvers
- Remove any resolver-related code from your implementation

### 3. Catalog and Models Module Changes

**Before (0.1.1):**
```typescript
import { StreamId } from "@whaly/connector-sdk/models/catalog";
import { ReplicationMethod } from "@whaly/connector-sdk/models/models";
```

**After (0.2.0):**
```typescript
import { StreamId } from "@whaly/connector-sdk/models/metadata";
import { ReplicationMethod } from "@whaly/connector-sdk/models/replication";
```

**Action Required:**
- Update imports: `StreamId` is now exported from `metadata` module
- Update imports: `ReplicationMethod` is now exported from `replication` module
