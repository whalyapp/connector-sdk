# connector-sdk Project Overview

## Purpose
`@whaly/connector-sdk` is a TypeScript SDK for building data connectors (ETL pipelines).
Architecture: **Tap** (data source) → **Stream** (data extraction) → **Target** (data destination).

Two connector types:
- **API connectors** — REST APIs via `RESTStream` (pagination, retries, auth)
- **File connectors** — Excel/CSV from GCS, SFTP, or local disk via `FileStream`/`FileTap`

## Key Components
- `RESTStream` — REST API stream with pagination and auth
- `FileStream` / `FileTap` — file-based data sources
- `CloudStorageService` — Google Cloud Storage client
- `SftpClient` — SFTP client
- `BigQueryTarget` — BigQuery target implementation
- `GCSStateProvider` — State management backed by GCS

## Tech Stack
- **Language**: TypeScript (strict mode, ES2022 target)
- **Runtime**: Node.js >= 18
- **Build**: tsup (outputs CJS + ESM + types)
- **Test**: Vitest
- **Key deps**: BigQuery, GCS, axios, csv-parser, xlsx, ajv, winston, lodash

## Code Style & Conventions
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- No explicit return type annotations required but preferred for public APIs
- No linter config found (no eslint/prettier config at root level)
- Test files: `*.test.ts` colocated with source
- `isolatedModules: true` — each file is a module
