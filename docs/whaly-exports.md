# Whaly Exports

`WhalyExportService` reads **Whaly exports** through the public API (`/v1/exports`). An export is defined in the
Whaly app: a fixed output schema over an object (its columns are named by the export, never by internal names),
granted to one or more service accounts. Each run snapshots the data and writes it as gzip-compressed JSON lines,
in parts of at most 1,000,000 rows, kept 7 days.

Use it when a connector must ship what users see in Whaly (form inputs, derivation results) rather than re-reading
the warehouse.

## Setup

```ts
import { WhalyExportService } from "@whaly/connector-sdk";

// Defaults to the WLY_API_ENDPOINT and WLY_SERVICE_ACCOUNT_KEY env vars
const exportsApi = new WhalyExportService({
    apiEndpoint: "https://my-org.my.whaly.io",
    serviceAccountKey: "sk:xxxx",
});
```

The export must be **granted to the service account** of the key, otherwise the API answers 404 (the error message
says so).

## Run an export and stream its rows

```ts
const run = await exportsApi.runAndWait("expt_xxx", { timeoutMs: 30 * 60_000 });
console.log(`${run.row_count} rows as of ${run.snapshot_at}`);

for await (const row of exportsApi.streamRows("expt_xxx", run.id)) {
    // row: { "ExternalID": "1000918", "DataValue": "9.9", ... }
}
```

- `runAndWait` starts a run, or joins the one already queued or running (one run per export at a time), then polls
  it (2 s, growing to 15 s between polls).
- `streamRows` reads the parts in key order. The run is re-read before each part, so the signed URL (valid 15
  minutes) is always fresh, and each part's row count is checked against the run.
- `fetchAllRows("expt_xxx")` does both and returns an array: only for small exports.

### Row format

Every row is one object with **every column present** (`null` when empty). Numbers are JSON strings (`"184"`,
`"1312.50"`), `date` is `YYYY-MM-DD`, `datetime` is ISO 8601 UTC with microseconds. New columns can be added at the
end of the schema without notice: read the columns you need by name, and check `getExport(id).columns` (or
`schema_version`) when the shape matters.

## Other calls

| Method | Does |
|---|---|
| `listExports()` | every export granted to the key (all pages) |
| `getExport(id)` | the export's columns, primary key, schema version and last successful run |
| `startRun(id)` / `waitForRun(id, runId, options)` | the two halves of `runAndWait` |
| `getRun(id, runId)` | one run, with fresh signed URLs once succeeded |
| `listRuns(id, { status, limit })` | run history, newest first |
| `getLatestSucceededRun(id)` | the last good extract (its files may have expired after 7 days) |
| `cancelRun(id, runId)` | cancel a queued or running run |

## Errors

- A run that fails, is cancelled or expired, or does not finish within `timeoutMs` (default 30 minutes) throws
  `WhalyExportRunError`, with `exportId` and the last `run` read (its `error.kind` / `error.message`).
- HTTP errors carry the method, URL, status and response body. No response, 429 and 5xx are retried with exponential
  backoff (honouring `Retry-After`).
