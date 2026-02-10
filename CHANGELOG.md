# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-02-10

### Added

- **`APPEND` Replication Method**: New `ReplicationMethod.APPEND` for accumulating incoming data without touching existing rows
  - Pure `INSERT INTO ... SELECT ... FROM staging` query — no truncate, no merge, no deduplication
  - Does not require primary keys (unlike `INCREMENTAL`)
  - Supports intermediate batch flushing (>1M rows) to avoid memory pressure
  - Added `abstract getAppendQueries()` to `StreamWarehouseSyncService` and implemented it in `BigQueryDBSync`

- **File Processing Module**: Complete file processing system for Excel and CSV files
  - `FileStream` and `FileTap` classes that integrate file processing into the Tap → Stream → Target pipeline
  - `ExcelSingleSheetExtractionConfig` for declarative column mapping from Excel sheets
  - `ExcelCustomExtractorConfig` for custom workbook processing via processor functions
  - `ExcelExtractionConfigBuilder` fluent builder for Excel configurations
  - `CsvFileConfig` with support for custom separators, encodings (via iconv-lite), BOM stripping, and field transformers
  - Both dict-style (keyed by header name) and array-style (positional) CSV field definitions
  - `createExcelStreamConfig()` and `createCsvStreamConfig()` helper functions
  - `processFileStreams()` for sequential file processing without the full Tap lifecycle
  - Schema auto-generation from field configs via `excelFieldsToJsonSchema()` and `csvFieldsToJsonSchema()`
  - Primary key extraction from field definitions
  - `FilePatterns` utility class for filename validation (`startsWith`, `regex`, `and`, `or`)
  - `VariableExtractors` utility class for extracting variables from filenames
  - Derived fields support: inject variables extracted from filenames or workbook metadata into output columns
  - Excel utility functions: `excelColumnToIndex`, `indexToExcelColumn`, `parseCellReference`, `createCellReference`, etc.
  - `findAllMatchingConfigs()` to match filenames against an array of extraction configs
  - `validateExcelConfig()` for config validation
  - CSV writing utilities: `writeDataToCsv()` and `writeGeneratorToCSV()` (with 10k-row batching)
  - CSV header validation with hex-level debugging for encoding issues

- **Cloud Storage Service**: `CloudStorageService` class for Google Cloud Storage integration
  - File listing, downloading, and uploading
  - Marker-file-based tracking to prevent reprocessing (`.processed` suffix)
  - Configurable file extension filtering

- **SFTP Service**: Re-exported `SftpClient` and `SftpConnectOptions` from ssh2-sftp-client

- **Archive Extraction**: `unzip()` utility supporting ZIP, TAR, GZ, and BZ2 via the `decompress` library

### Changed

- **`keyProperties` validation relaxed**: `APPEND` streams are now allowed to have empty `keyProperties` since no merge/upsert is performed

### Removed

- **`appendOnly` flag**: Removed the unused `appendOnly?: boolean` field from `FileStreamBaseConfig` — superseded by `ReplicationMethod.APPEND`

### Dependencies Added

- `xlsx` (0.20.3) - Excel file reading
- `csv-parser` (3.2.0) - CSV parsing
- `csv-writer` (1.6.0) - CSV writing
- `iconv-lite` (0.6.3) - Character encoding conversion
- `ssh2-sftp-client` (12.0.0) - SFTP client
- `decompress` (4.2.1) - Archive extraction

## [0.2.0] - 2024-11-10

### Added

- **State Provider System**: Introduced a new state provider abstraction with `StateProvider` interface and `StateHolder` type
- **GCS State Provider**: Added Google Cloud Storage state provider implementation (`GCSStateProvider`) for managing connector state in GCS buckets
- **GCS Service Utilities**: Added utility functions for reading and writing objects to Google Cloud Storage
- **Replication Model**: Added `ReplicationMethod` enum (`INCREMENTAL`, `FULL_TABLE`) in a dedicated `replication.ts` module
- **Enhanced Exports**: Improved module organization with clearer section comments for Taps, State Providers, and Targets

### Changed

- **Date Library Migration**: Replaced `moment` with `dayjs` for date/time operations (smaller bundle size, better performance)
- **StateService API**: 
  - `setBookmark()` now accepts `StreamState` instead of `moment.Moment`
  - `setBookmarkSignpostV2()` renamed to `setBookmarkSignpost()`
  - Removed deprecated `setBookmark()` method that accepted `moment.Moment`
  - Removed deprecated `getBookmark()` method that returned `moment.Moment`
- **Metadata Model**: Significantly simplified metadata implementation, moved `StreamId` type definition to `metadata.ts`
- **Module Organization**: Improved code organization with better separation of concerns

### Removed

- **Resolver System**: Removed resolver functionality including:
  - `Resolver` model and service
  - Local file resolver implementation
  - Schema hooks for resolvers
- **Relationship System**: Removed relationship management functionality:
  - `Relationship` model
  - Relationship service
- **Catalog Model**: Removed standalone `Catalog` model (functionality integrated elsewhere)
- **Models Module**: Removed generic `models.ts` module (types moved to specific modules)

### Migration

See [MIGRATION.md](./MIGRATION.md) for detailed migration instructions from 0.1.1 to 0.2.0.

## [0.1.1] - Previous Release

Initial release of the connector SDK.

