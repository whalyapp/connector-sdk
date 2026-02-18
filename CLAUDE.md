# connector-sdk

## Commands

```bash
npm test           # Run all tests (vitest)
npm run typecheck  # Type-check without emitting
npm run build      # Build CJS + ESM + types via tsup
```

## Architecture

Pipeline: **Tap → Stream → Target**

- `src/sdk/models/tap/` — base Tap/Stream classes (RESTStream, FileTap)
- `src/sdk/models/target/` — base Target classes
- `src/sdk/file-processing/` — CSV & Excel readers/writers
- `src/targets/bigquery/` — BigQuery target implementation
- `src/state-providers/gcs/` — GCS state provider
- `src/services/` — GCS, SFTP, ZIP services
- `src/index.ts` — public API surface

## Code Style

- Strict TypeScript: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- Tests colocated with source as `*.test.ts`
- No linter/formatter configured — match surrounding code style

## Tools

**Serena MCP** is available in this project for semantic code navigation:
use `find_symbol`, `find_referencing_symbols`, `replace_symbol_body`, etc.
Prefer Serena's symbolic tools over raw file reads for code exploration and editing.
