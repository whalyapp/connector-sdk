# @whaly/connector-sdk

A TypeScript SDK for building data connectors with support for file processing (Excel/CSV), cloud storage, SFTP, and BigQuery.

## Installation

```bash
npm install @whaly/connector-sdk
```

## Overview

The SDK provides a pipeline architecture: **Tap** (data source) &rarr; **Stream** (data extraction) &rarr; **Target** (data destination).

It supports two main connector types:
- **API connectors** — sync data from REST APIs using `RESTStream` with built-in pagination, retries, and auth
- **File connectors** — ingest Excel/CSV files from GCS, SFTP, or local disk using `FileStream`

### Key Components

| Component | Description |
|---|---|
| `RESTStream` | Stream for REST API endpoints with pagination and auth |
| `FileStream` / `FileTap` | Stream and Tap implementations for file-based data sources |
| `CloudStorageService` | Google Cloud Storage client with marker-file tracking |
| `SftpClient` | SFTP client for remote file access |
| `BigQueryTarget` | BigQuery target implementation |
| `GCSStateProvider` | State management backed by GCS |

## Quick Start

```typescript
import {
  CloudStorageService,
  createExcelStreamConfig,
  processFileStreams,
  FilePatterns,
  VariableExtractors,
  ReplicationMethod,
} from "@whaly/connector-sdk";

// Define how to read your Excel file
const config = {
  type: "single-sheet-extraction" as const,
  extension: "xlsx",
  tableName: "products",
  sheetName: "Sheet1",
  numberOfRowsToSkip: 1,
  replicationMethod: ReplicationMethod.FULL_TABLE,
  fileNameValidator: FilePatterns.startsWith("product"),
  fileNameVariablesExtractor: VariableExtractors.filename(),
  columns: {
    product_id:   { type: "STRING" as const, column: "A", primaryKey: true },
    product_name: { type: "STRING" as const, column: "B" },
    price:        { type: "FLOAT"  as const, column: "C" },
  },
};

// Download from GCS, process, and send to target
const storage = new CloudStorageService("my-bucket", "incoming/", {
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

## Documentation

| Document | Description |
|---|---|
| [API Reference](./docs/api-reference.md) | Building API connectors (RESTStream, Tap, Auth), core types, and full reference |
| [File Processing Guide](./docs/file-processing.md) | Excel & CSV import, services (GCS, SFTP, ZIP), full examples |
| [Changelog](./CHANGELOG.md) | Release history |
| [Migration Guide](./MIGRATION.md) | Upgrade instructions between versions |

## License

Apache-2.0
