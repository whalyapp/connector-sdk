# DRY_RUN Asset Inspection — Design

**Date:** 2026-02-23
**Status:** Approved

## Problem

When running an asset connector in `DRY_RUN=true` mode, transformed files are
downloaded and processed but immediately deleted. Only a `manifest.json` is
written to `out/`. This makes it impossible to visually validate that images are
correct and properly transformed before running a real sync.

## Solution

Two additions to `AssetTap.sync()`, both gated on `isDryRun()`:

### 1. File preservation in `out/`

After download + transform, copy the transformed file to
`out/<streamId>/<destinationPath>` before the `finally` cleanup. Tmp files are
still deleted as before.

Output structure:
```
out/
  ai-product-photos/
    3041091440396.webp
    3041091022875.webp
  bsa-product-photos/
    3041091678201.webp
  manifest.json
```

### 2. Per-stream asset limit via `DRY_RUN_LIMIT`

New optional env var `DRY_RUN_LIMIT=<n>`. When set, the `for await` loop over
`stream.listAssets()` breaks after processing `n` assets for each stream. Allows
fast early termination for validation without waiting for full syncs.

- Unset or `0` → no limit (existing behavior)
- `DRY_RUN_LIMIT=5` → process at most 5 assets per stream

## Scope

Changes are limited to the connector-sdk:

- `src/sdk/service/dryRun.ts` — add `getDryRunLimit()` helper
- `src/sdk/models/asset-tap/asset-tap.ts` — use limit + copy files to `out/` in dry-run

No changes to connector code. Fully backward-compatible: normal runs (no
`DRY_RUN`) are unaffected.

## Non-goals

- No global limit across streams (per-stream is sufficient for sampling)
- No changes to non-asset (BigQuery) tap behavior
