# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

