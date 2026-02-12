# API Reference

## Table of Contents

- [Core Concepts](#core-concepts)
- [Building an API Connector](#building-an-api-connector)
  - [Project Structure](#project-structure)
  - [1. Define Your Config](#1-define-your-config)
  - [2. Implement an Authenticator](#2-implement-an-authenticator)
  - [3. Implement a RESTStream](#3-implement-a-reststream)
  - [4. Implement a Tap](#4-implement-a-tap)
  - [5. Wire Everything Together](#5-wire-everything-together)
  - [Full Example: Paginated REST API](#full-example-paginated-rest-api)
- [Core Classes](#core-classes)
  - [Stream](#stream)
  - [RESTStream](#reststream)
  - [Tap](#tap)
  - [Authenticator](#authenticator)
- [Core Types](#core-types)
- [File Processing Types](#file-processing-types)
- [File Processing Functions](#file-processing-functions)
- [File Processing Classes](#file-processing-classes)
- [Services](#services)

---

## Core Concepts

The SDK follows a pipeline architecture:

```
Tap  →  Stream(s)  →  Target
         ↑
    StateProvider
```

| Concept | Description |
|---|---|
| **Tap** | Data source. Initializes and orchestrates one or more Streams |
| **Stream** | Extracts records from a single data source (API endpoint, file, etc.) |
| **Target** | Data destination (e.g. BigQuery). Receives schema, records, and state |
| **StateProvider** | Persists sync state (bookmarks) between runs for incremental sync |
| **Authenticator** | Provides auth headers/query params for HTTP requests |
| **ReplicationMethod** | `FULL_TABLE` (re-sync everything) or `INCREMENTAL` (sync from last bookmark) |

---

## Building an API Connector

### Project Structure

```
my-connector/
├── src/
│   ├── index.ts              # Entry point: wires Tap + Target + StateProvider
│   ├── tap.ts                # Tap implementation (registers streams)
│   ├── auth.ts               # Authenticator (API key, OAuth, Basic Auth, etc.)
│   └── streams/
│       ├── common.ts         # Shared types and parsing helpers
│       ├── customers.ts      # RESTStream for /customers endpoint
│       └── orders.ts         # RESTStream for /orders endpoint
├── schemas/
│   ├── customers.json        # JSON Schema for customers output
│   └── orders.json           # JSON Schema for orders output
├── package.json
└── tsconfig.json
```

### 1. Define Your Config

```typescript
// src/index.ts
export interface TapConfig {
  api_key: string;
  base_url: string;
  start_date?: string; // used by getStartingTimestamp() for incremental sync
}
```

### 2. Implement an Authenticator

The `Authenticator` class provides auth headers and/or query params that are automatically injected into every HTTP request.

**API Key auth:**

```typescript
// src/auth.ts
import { Authenticator, type HTTPHeaders } from "@whaly/connector-sdk";
import type { TapConfig } from "./index.js";

export class ApiKeyAuth extends Authenticator<TapConfig> {
  async getAuthHeaders(config: TapConfig): Promise<HTTPHeaders> {
    return {
      Authorization: `Bearer ${config.api_key}`,
    };
  }
}
```

**Basic auth:**

```typescript
export class BasicAuth extends Authenticator<TapConfig> {
  async getAuthHeaders(config: TapConfig): Promise<HTTPHeaders> {
    const encoded = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    return {
      Authorization: `Basic ${encoded}`,
    };
  }
}
```

**OAuth2 with token refresh:**

```typescript
export class OAuth2Auth extends Authenticator<TapConfig> {
  private accessToken?: string;
  private expiresAt?: Date;

  async getAuthHeaders(config: TapConfig): Promise<HTTPHeaders> {
    if (!this.accessToken || new Date() > (this.expiresAt ?? new Date(0))) {
      await this.refreshToken(config);
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async refreshToken(config: TapConfig): Promise<void> {
    // POST to token endpoint, set this.accessToken and this.expiresAt
  }
}
```

### 3. Implement a RESTStream

`RESTStream` is the main class for syncing data from REST APIs. It handles HTTP requests, pagination, retries, and metrics automatically.

```typescript
RESTStream<R, O, NPT, C, P?>
```

| Type Parameter | Description |
|---|---|
| `R` | Raw API response type |
| `O` | Output record type (what gets sent to the Target) |
| `NPT` | Next page token type (e.g. `{ cursor: string }`, `number`, etc.) |
| `C` | Tap config type |
| `P` | Parent type (for child streams, optional) |

**Minimal example (single-page endpoint):**

```typescript
// src/streams/customers.ts
import { RESTStream, ReplicationMethod } from "@whaly/connector-sdk";
import type { TapConfig } from "../index.js";
import { ApiKeyAuth } from "../auth.js";

interface ApiResponse {
  data: Array<{ id: string; name: string; email: string }>;
}

interface Customer {
  id: string;
  name: string;
  email: string;
}

export class CustomersStream extends RESTStream<ApiResponse, Customer, undefined, TapConfig> {
  streamId = "customers";
  primaryKey = ["id"];
  replicationMethod = ReplicationMethod.FULL_TABLE;

  baseUrl = this.config.base_url;
  path = "/api/v1/customers";
  authenticator = new ApiKeyAuth();
  schemaPath = "customers.json";

  async *parseResponse(response: ApiResponse): AsyncIterable<Customer> {
    for (const item of response.data) {
      yield {
        id: item.id,
        name: item.name,
        email: item.email,
      };
    }
  }
}
```

**With pagination and incremental sync:**

```typescript
import { RESTStream, ReplicationMethod, type URLParams } from "@whaly/connector-sdk";
import dayjs from "dayjs";

interface ApiResponse {
  results: Array<{ id: string; name: string; updated_at: string }>;
  next_cursor?: string;
}

interface Order {
  id: string;
  name: string;
  updated_at: string;
}

interface PageToken {
  cursor: string;
}

export class OrdersStream extends RESTStream<ApiResponse, Order, PageToken, TapConfig> {
  streamId = "orders";
  primaryKey = ["id"];
  replicationMethod = ReplicationMethod.INCREMENTAL;
  replicationKey = "updated_at";
  isSorted = false; // set to true if API returns records sorted by replicationKey

  baseUrl = this.config.base_url;
  path = "/api/v1/orders";
  authenticator = new ApiKeyAuth();
  schemaPath = "orders.json";

  // Add query parameters (filtering, pagination)
  getNextUrlParams(nextPageToken: PageToken | undefined): URLParams {
    const params: URLParams = {};

    // Use the bookmark from last sync for incremental filtering
    const startTimestamp = this.getStartingTimestamp();
    params.updated_since = dayjs(startTimestamp).toISOString();

    if (nextPageToken) {
      params.cursor = nextPageToken.cursor;
    }

    return params;
  }

  // Extract pagination token from the response
  getNextPageToken(response: ApiResponse): PageToken | undefined {
    if (response.next_cursor) {
      return { cursor: response.next_cursor };
    }
    return undefined; // no more pages
  }

  // Transform raw API response into output records
  async *parseResponse(response: ApiResponse): AsyncIterable<Order> {
    for (const item of response.results) {
      yield {
        id: item.id,
        name: item.name,
        updated_at: item.updated_at,
      };
    }
  }
}
```

### JSON Schema File

Each stream needs a JSON Schema file in the `schemas/` directory. The `schemaPath` property points to it (relative to `schemas/`).

```json
// schemas/orders.json
{
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "id": {
      "type": ["string", "null"]
    },
    "name": {
      "type": ["string", "null"]
    },
    "updated_at": {
      "type": ["string", "null"],
      "format": "date-time"
    }
  }
}
```

Alternatively, override `getSchema()` to return a dynamic schema instead of using a JSON file.

### 4. Implement a Tap

The Tap registers all streams in its `init()` method:

```typescript
// src/tap.ts
import { Tap } from "@whaly/connector-sdk";
import type { TapConfig } from "./index.js";
import { CustomersStream } from "./streams/customers.js";
import { OrdersStream } from "./streams/orders.js";

export class MyTap extends Tap<TapConfig> {
  async init(): Promise<void> {
    this.streams.push(
      new CustomersStream(this.config, this.tapState, this.target),
      new OrdersStream(this.config, this.tapState, this.target),
    );
  }
}
```

### 5. Wire Everything Together

```typescript
// src/index.ts
import { BigQueryTarget, GCSStateProvider, type BigQueryConfig } from "@whaly/connector-sdk";
import { MyTap } from "./tap.js";

export interface TapConfig {
  api_key: string;
  base_url: string;
}

const tapConfig: TapConfig = {
  api_key: process.env.TAP_API_KEY!,
  base_url: process.env.TAP_BASE_URL!,
};

const targetConfig: BigQueryConfig = {
  connector_id: process.env.CONNECTOR_ID!,
  project_id: process.env.TARGET_PROJECT_ID!,
  database: process.env.TARGET_DATABASE!,
  schema: process.env.TARGET_SCHEMA!,
  loading_deck_gcs_bucket_name: process.env.TARGET_LOADING_DECK_GCS_BUCKET_NAME!,
};

const stateProvider = new GCSStateProvider(
  targetConfig.connector_id,
  process.env.STATE_GCS_BUCKET!,
);
const target = new BigQueryTarget(targetConfig, stateProvider);
const tap = new MyTap(target, tapConfig, stateProvider);

await tap.sync();
```

### Full Example: Paginated REST API

A complete connector syncing from a paginated REST API with incremental replication:

```typescript
// src/streams/contacts.ts
import {
  RESTStream,
  ReplicationMethod,
  type HTTPMethod,
  type URLParams,
} from "@whaly/connector-sdk";
import type { TapConfig } from "../index.js";
import { ApiKeyAuth } from "../auth.js";
import dayjs from "dayjs";

// --- Types ---

interface ContactsApiResponse {
  data: RawContact[];
  pagination: {
    next_page?: number;
    total_pages: number;
  };
}

interface RawContact {
  ContactID: string;
  FirstName: string;
  LastName: string;
  Email: string;
  Company: string;
  CreatedAt: string;
  ModifiedAt: string;
}

interface Contact {
  contact_id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  created_at: string;
  modified_at: string;
}

// --- Stream ---

export class ContactsStream extends RESTStream<
  ContactsApiResponse, // R: raw API response
  Contact,             // O: normalized output
  number,              // NPT: page number
  TapConfig            // C: tap config
> {
  // Stream identity
  streamId = "contacts";
  primaryKey = ["contact_id"];
  schemaPath = "contacts.json";

  // Replication
  replicationMethod = ReplicationMethod.INCREMENTAL;
  replicationKey = "modified_at";

  // HTTP
  baseUrl = this.config.base_url;
  path = "/api/v1/contacts";
  httpMethod: HTTPMethod = "GET";
  httpRetryCount = 3;
  authenticator = new ApiKeyAuth();

  // Query parameters: filtering + pagination
  getNextUrlParams(nextPageToken: number | undefined): URLParams {
    const startTs = this.getStartingTimestamp();

    return {
      modified_since: dayjs(startTs).subtract(1, "day").toISOString(),
      page: nextPageToken ?? 1,
      per_page: 100,
    };
  }

  // Pagination: return next page number or undefined to stop
  getNextPageToken(response: ContactsApiResponse, previousToken?: number): number | undefined {
    const currentPage = previousToken ?? 1;
    if (currentPage < response.pagination.total_pages) {
      return currentPage + 1;
    }
    return undefined;
  }

  // Transform raw API records to normalized output
  async *parseResponse(response: ContactsApiResponse): AsyncIterable<Contact> {
    for (const raw of response.data) {
      yield {
        contact_id: raw.ContactID,
        first_name: raw.FirstName,
        last_name: raw.LastName,
        email: raw.Email,
        company: raw.Company,
        created_at: raw.CreatedAt,
        modified_at: raw.ModifiedAt,
      };
    }
  }
}
```

---

## Core Classes

### Stream

Abstract base class for all data streams. Handles schema emission, record syncing, state management, and metrics.

```typescript
abstract class Stream<O, C, P?>
```

| Property | Type | Default | Description |
|---|---|---|---|
| `streamId` | `string` | `"default"` | Unique identifier for the stream |
| `primaryKey` | `string[]` | `[]` | Fields forming the primary key |
| `replicationMethod` | `ReplicationMethod` | - | `FULL_TABLE` or `INCREMENTAL` |
| `replicationKey` | `string?` | - | Field used for incremental bookmarking |
| `schemaPath` | `string?` | - | Path to JSON Schema file (relative to `schemas/`) |
| `isSorted` | `boolean` | `false` | Whether records arrive sorted by replicationKey |
| `isSilent` | `boolean` | `false` | Skip SCHEMA/RECORD messages (state only) |
| `children` | `Stream[]` | `[]` | Child streams synced per parent record |
| `selectedByDefault` | `boolean` | `true` | Whether the stream is selected for sync |
| `displayLabel` | `string?` | - | Human-readable label |
| `description` | `string?` | - | Stream description |
| `useStateFromStreamId` | `string?` | - | Read state from another stream |

| Method | Description |
|---|---|
| `sync()` | Run the full sync lifecycle (schema &rarr; records &rarr; state) |
| `getSchema()` | Return the stream's JSON Schema. Override for dynamic schemas |
| `_getRecords(parent?)` | Abstract: yield output records. Must be implemented by subclasses |
| `asyncInit(parent?)` | Optional async initialization hook |
| `getStartingTimestamp()` | Return the bookmark timestamp (from state, config `start_date`, or epoch) |
| `getReplicationKeySignpost()` | Return the max bookmark value for this sync (defaults to `dayjs()`) |
| `_flush()` | Hook called after all records are synced |

### RESTStream

Extends `Stream` with HTTP request handling, pagination, retries, and auth.

```typescript
abstract class RESTStream<R, O, NPT, C, P?> extends Stream<O, C, P>
```

| Property | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `""` | API base URL |
| `path` | `string` | `""` | API endpoint path |
| `httpMethod` | `HTTPMethod` | `"GET"` | HTTP method (`"GET"` or `"POST"`) |
| `httpRetryCount` | `number` | `24` | Number of retries on failure |
| `authenticator` | `Authenticator<C>?` | - | Authenticator instance for auth headers/params |

| Method | Override? | Description |
|---|---|---|
| `getNextUrl(previousToken?, parent?)` | Optional | Build the full URL. Default: `baseUrl + path` |
| `getNextUrlParams(nextPageToken?, parent?)` | Optional | Return query parameters. Default: `{}` |
| `getNextPageToken(response, previousToken?)` | Optional | Extract next page token. Return `undefined` to stop. Default: `undefined` (single page) |
| `getRequestBodyForNextCall(nextPageToken?, parent?)` | Optional | Return POST body. Default: `undefined` |
| `getCustomHTTPHeaders(parent?)` | Optional | Return additional HTTP headers. Default: `undefined` |
| `parseResponse(response, parent?, nextPageToken?)` | Optional | Async generator yielding output records. Default: yields response directly |
| `httpErrorHandler(url, error)` | Optional | Handle HTTP errors. Return a value to recover, `undefined` to stop silently, or throw |

**Pagination loop:**
1. Call `getNextUrl()` + `getNextUrlParams()` to build the request
2. Execute HTTP request with auth headers and retries
3. Call `parseResponse()` to yield records
4. Call `getNextPageToken()` — if it returns a value, go to step 1; otherwise stop

### Tap

Abstract base class for data sources. Manages streams and sync lifecycle.

```typescript
abstract class Tap<C>
```

| Property | Type | Default | Description |
|---|---|---|---|
| `config` | `C` | - | Tap configuration |
| `streams` | `Stream[]` | `[]` | Registered streams |
| `concurrency` | `number` | `5` | Max concurrent stream syncs |
| `target` | `ITarget` | - | The data target |
| `stateProvider` | `StateProvider` | - | State persistence |
| `tapState` | `InputTapState` | `{ bookmarks: {} }` | Current state (loaded from provider) |

| Method | Description |
|---|---|
| `abstract init()` | Register streams by pushing to `this.streams` |
| `sync(options?)` | Load state, call `init()`, sync all streams, call `target.complete()` |
| `end()` | Cleanup hook (override if needed) |

`SyncOptions`:
- `include?: string[]` — only sync these stream IDs (also configurable via `TAP_STREAMS` env var)
- `exclude?: string[]` — skip these stream IDs

### Authenticator

Base class for authentication. Override the methods you need.

```typescript
class Authenticator<C>
```

| Method | Default | Description |
|---|---|---|
| `getAuthHeaders(config)` | `{}` | Return headers to inject (e.g. `Authorization`) |
| `getAuthQS(config)` | `{}` | Return query params to inject (e.g. `api_key=...`) |

---

## Core Types

### HTTP

```typescript
type HTTPMethod = "GET" | "POST";

interface HTTPHeaders {
  [headerName: string]: any;
}

interface URLParams {
  [paramName: string]: any;
}
```

### State

```typescript
interface InputTapState {
  bookmarks?: { [streamId: string]: StreamState };
}

interface StreamState {
  replicationKey?: string;
  replicationKeyValue?: string; // ISO 8601
  progressMarkers?: ProgressMarkers;
  replicationKeySignpost?: string;
}

interface StateProvider {
  getState(): Promise<StateHolder>;
  writeState(state: string): Promise<void>;
}

interface StateHolder {
  state?: any;
}
```

### Schema

```typescript
interface Schema {
  jsonSchema: {
    type: "object";
    properties: any;
  };
  propertiesMetadata?: {
    [propName: string]: { label: string; description?: string };
  };
}
```

### Replication

```typescript
enum ReplicationMethod {
  FULL_TABLE = "FULL_TABLE",
  INCREMENTAL = "INCREMENTAL",
}
```

---

## File Processing Types

### Field & Format Types

| Type | Definition |
|---|---|
| `FieldType` | `"STRING" \| "FLOAT" \| "TIMESTAMP"` |
| `FileFormat` | Enum: `FileFormat.CSV`, `FileFormat.EXCEL` |

### Excel Types

| Type | Description |
|---|---|
| `ExcelSourceColumn` | Column mapped to an Excel cell: `{ type: FieldType, column: string, primaryKey?: boolean }` |
| `ExcelDerivedField` | Column derived from a variable: `{ variableName: string, type: FieldType, primaryKey?: boolean }` |
| `ExcelFieldSpec` | Union: `ExcelSourceColumn \| ExcelDerivedField` |
| `ExcelFieldMapping` | `{ [outputKey: string]: ExcelFieldSpec }` |
| `ExcelExtractionConfig` | Union: `ExcelSingleSheetExtractionConfig \| ExcelCustomExtractorConfig` |
| `ExcelExtractionBaseConfig` | Shared base fields for all Excel configs |
| `ExcelSingleSheetExtractionConfig` | Config for column-mapped extraction from a single sheet |
| `ExcelCustomExtractorConfig` | Config with a custom processor function |
| `WorkBook` | Re-exported from `xlsx` library |

#### ExcelExtractionBaseConfig

```typescript
interface ExcelExtractionBaseConfig {
  type: "single-sheet-extraction" | "processor";
  extension: string;
  fileNameValidator: (fileName: string) => boolean;
  fileNameVariablesExtractor: (
    fileName: string,
    workbook?: WorkBook,
  ) => { [key: string]: string | undefined };
  tableName:
    | string
    | ((
        fileName: string,
        workbook?: WorkBook,
        variables?: { [key: string]: string | undefined },
      ) => string);
  replicationMethod: ReplicationMethod;
}
```

#### ExcelSingleSheetExtractionConfig

Extends `ExcelExtractionBaseConfig` with:

```typescript
{
  type: "single-sheet-extraction";
  columns: ExcelFieldMapping;
  sheetName?: string;               // defaults to first sheet
  numberOfRowsToSkip: number;
}
```

#### ExcelCustomExtractorConfig

Extends `ExcelExtractionBaseConfig` with:

```typescript
{
  type: "processor";
  processor: (workbook: WorkBook) => Promise<Record<string, string>[]>;
}
```

### CSV Types

| Type | Description |
|---|---|
| `CsvFileConfig` | CSV parsing config: `{ separator, encoding?, fields, addSyncedAtColumn? }` |
| `CsvFieldsConfig` | Union: `CsvFieldsArrayConfig \| CsvFieldsDictConfig` |
| `CsvFieldsArrayConfig` | `Array<{ key: string, type: FieldType, valueTransformer?: (val: any) => string }>` |
| `CsvFieldsDictConfig` | `{ [csvHeader: string]: { key: string, type: FieldType, valueTransformer?: (val: any) => string } }` |

### Stream Config Types

| Type | Description |
|---|---|
| `FileStreamConfig` | Discriminated union: `CsvStreamConfig \| ExcelStreamConfig` |
| `CsvStreamConfig` | `{ format: FileFormat.CSV, streamId, replicationMethod, primaryKeys, appendOnly?, csv: CsvFileConfig }` |
| `ExcelStreamConfig` | `{ format: FileFormat.EXCEL, streamId, replicationMethod, primaryKeys, appendOnly?, excel: ExcelExtractionConfig }` |
| `FileStreamEntry` | `{ config: FileStreamConfig, filePath: string \| string[] }` |

---

## File Processing Functions

### Stream Config Builders

#### `createExcelStreamConfig(excelConfig, fileName, localFilePath?)`

Builds a `FileStreamConfig` from an `ExcelExtractionConfig`.

| Parameter | Type | Description |
|---|---|---|
| `excelConfig` | `ExcelExtractionConfig` | The extraction config |
| `fileName` | `string` | Base filename (used for variable extraction and table name) |
| `localFilePath` | `string?` | Local file path; required for processor configs with dynamic table names |

**Returns:** `FileStreamConfig`

#### `createCsvStreamConfig(streamId, csvConfig, options?)`

Builds a `FileStreamConfig` from a `CsvFileConfig`.

| Parameter | Type | Description |
|---|---|---|
| `streamId` | `string` | Stream/table name |
| `csvConfig` | `CsvFileConfig` | CSV file configuration |
| `options.replicationMethod` | `ReplicationMethod?` | Defaults to `FULL_TABLE` |
| `options.primaryKeys` | `string[]?` | Defaults to all field keys |

**Returns:** `FileStreamConfig`

### Processing

#### `processFileStreams(entries, tapState, target)`

Processes an array of file entries sequentially, then signals completion to the target.

| Parameter | Type | Description |
|---|---|---|
| `entries` | `FileStreamEntry[]` | Array of config + file path pairs |
| `tapState` | `InputTapState` | Typically `{ bookmarks: {} }` |
| `target` | `ITarget` | The target (e.g. `BigQueryTarget`) |

**Returns:** `Promise<void>`

### Excel Reading

| Function | Returns | Description |
|---|---|---|
| `extractExcelRows(localFilePath, config)` | `Promise<Record<string, string>[]>` | Low-level: extract rows from an Excel file |
| `createExcelGenerator(data)` | `AsyncGenerator<Record<string, any>>` | Wrap an array of records into an async generator |
| `findAllMatchingConfigs(filename, configs)` | `ExcelExtractionConfig[]` | Find configs matching a filename |
| `validateExcelConfig(config)` | `void` | Validate an Excel extraction config (throws on error) |

### Excel Cell Utilities

| Function | Signature | Description |
|---|---|---|
| `excelColumnToIndex` | `(columnLetter: string) => number` | `"A"` &rarr; `0`, `"AA"` &rarr; `26` |
| `indexToExcelColumn` | `(index: number) => string` | `0` &rarr; `"A"`, `26` &rarr; `"AA"` |
| `excelRowToIndex` | `(rowNumber: string \| number) => number` | 1-based to 0-based |
| `indexToExcelRow` | `(index: number) => number` | 0-based to 1-based |
| `parseCellReference` | `(cellRef: string) => { columnIndex, rowIndex }` | `"B3"` &rarr; `{ 1, 2 }` |
| `createCellReference` | `(columnIndex, rowIndex) => string` | `(1, 2)` &rarr; `"B3"` |

### CSV Reading

| Function | Returns | Description |
|---|---|---|
| `rowGeneratorFromCsv(path, fileConfig)` | `AsyncGenerator<Record<string, any>>` | Async generator yielding parsed CSV rows |
| `checkCsvHeaderRow(path, fileConfig)` | `Promise<void>` | Validate CSV headers against config |

### CSV Writing

| Function | Returns | Description |
|---|---|---|
| `writeDataToCsv(fileName, data)` | `Promise<void>` | Write array of objects to CSV |
| `writeGeneratorToCSV(generator, outputFileName)` | `Promise<number>` | Write async generator to CSV (10k batches). Returns row count |

### Schema Utilities

| Function | Description |
|---|---|
| `fieldTypeToJsonSchema(fieldType)` | Converts a `FieldType` to a JSON Schema property |
| `excelFieldsToJsonSchema(fields)` | Converts an `ExcelFieldMapping` to JSON Schema |
| `csvFieldsToJsonSchema(config)` | Converts a `CsvFieldsConfig` to JSON Schema |
| `extractPrimaryKeysFromExcelFields(fields)` | Returns keys where `primaryKey: true` |
| `extractPrimaryKeysFromCsvConfig(config)` | Returns all field output keys |

---

## File Processing Classes

### FileStream

Extends `Stream<Record<string, any>, FileStreamConfig>`. Bridges file processing into the SDK pipeline.

```typescript
new FileStream(config: FileStreamConfig, localFilePath: string | string[], tapState: InputTapState, target: ITarget)
```

| Method | Description |
|---|---|
| `getSchema()` | Returns JSON Schema from field definitions |
| `_getRecords()` | Yields records from Excel/CSV files |

### FileTap

Extends `Tap<FileTapConfig>`. Orchestrates multiple `FileStream` instances.

```typescript
new FileTap(target: ITarget, config: FileTapConfig, stateProvider: StateProvider, entries: FileStreamEntry[])
```

| Method | Description |
|---|---|
| `static fromConfigs(target, config, stateProvider, fileConfigs, sharedFilePath)` | Convenience constructor when all configs share the same file |
| `init()` | Creates FileStream instances from entries |

### ExcelExtractionConfigBuilder

Fluent builder for `ExcelExtractionConfig`.

```typescript
ExcelExtractionConfigBuilder.create()
  .extension("xlsx")
  .tableName("my_table")
  .singleSheet("Sheet1", 1)
  .fileValidator(fn)
  .variablesExtractor(fn)
  .replicationMethod(ReplicationMethod.FULL_TABLE)
  .columns({ ... })
  .build()
```

### FilePatterns

Static utility methods for filename validation.

| Method | Description |
|---|---|
| `startsWith(prefix)` | Case-insensitive prefix match |
| `regex(pattern)` | Regex match |
| `and(...validators)` | All validators must match |
| `or(...validators)` | At least one validator must match |

### VariableExtractors

Static utility methods for extracting variables from filenames.

| Method | Description |
|---|---|
| `filename()` | Returns `{ fileName: <the filename> }` |
| `regex(pattern)` | Returns named capture groups from the pattern |
| `combine(...extractors)` | Merges results from multiple extractors |

---

## Services

### CloudStorageService

Google Cloud Storage client with marker-file-based processing tracking.

```typescript
new CloudStorageService(bucketName: string, path?: string, opts?: CloudStorageServiceOptions)
```

| Option | Default | Description |
|---|---|---|
| `processedSuffix` | `".processed"` | Suffix for marker files |
| `supportedExtensions` | `[]` (all files) | Filter files by extension |

| Method | Returns | Description |
|---|---|---|
| `listFiles(prefix?)` | `Promise<string[]>` | List all files in the bucket |
| `getUnprocessedFiles()` | `Promise<string[]>` | Files without a marker |
| `downloadFile(filePath, fileName)` | `Promise<string>` | Download to local `tmp/`, returns local path |
| `uploadFile(localPath, destPath)` | `Promise<File>` | Upload a local file to GCS |
| `createMarkerFile(fileName)` | `Promise<void>` | Create a `.processed` marker |

### SftpClient

Re-exported from `ssh2-sftp-client`. See [ssh2-sftp-client docs](https://github.com/theophilusx/ssh2-sftp-client).

```typescript
import { SftpClient, SftpConnectOptions } from "@whaly/connector-sdk";
```

### unzip

```typescript
unzip(zipFilePath: string, extractedPath: string): Promise<string>
```

Extracts an archive (ZIP, TAR, GZ, BZ2) to the given directory. Returns the output directory path.
