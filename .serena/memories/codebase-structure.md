# Codebase Structure

```
src/
  index.ts                        # Main entry point (re-exports everything)
  sdk/
    models/
      tap/                        # Tap/Stream base classes (tap.ts, stream.ts, restStream.ts, authenticator.ts)
      target/                     # Target base classes (target.ts, schema.ts, record.ts, dbSync.ts, ...)
      state-provider/             # State provider types
      schema.ts, state.ts, messages.ts, replication.ts, ...
    file-processing/
      csv/                        # CSV reader/writer/config-builder
      excel/                      # Excel reader/config-builder
      file-tap.ts, file-stream.ts, schema-utils.ts, file-patterns.ts, types.ts
    service/
      logger.ts, network.ts, metric.ts, memory.ts, error.ts, exit.ts
    helpers/
      typing.ts, qs-logger.ts
    constants/
      date.ts
    utils.ts
    reactive/
      batch.ts
  targets/
    bigquery/                     # BigQuery target implementation
      main.ts, helpers.ts
      service/bigquery.ts, record.ts, dbSync.ts
      models/config.ts
  state-providers/
    gcs/main.ts                   # GCS state provider
  services/
    cloud-storage.ts              # GCS client
    sftp.ts                       # SFTP client
    zip.ts                        # ZIP utilities
```

## Key Files
- `src/index.ts` — public API surface
- `src/sdk/models/tap/tap.ts` — base Tap class
- `src/sdk/models/tap/restStream.ts` — REST stream base
- `src/sdk/models/target/target.ts` — base Target class
- `src/sdk/file-processing/file-tap.ts` — file-based Tap
- `src/targets/bigquery/main.ts` — BigQuery target
- `src/services/cloud-storage.ts` — GCS service
