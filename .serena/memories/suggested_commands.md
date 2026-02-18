# Suggested Commands for connector-sdk

## Build
```bash
npm run build       # Build CJS + ESM + types via tsup
npm run clean       # Remove dist/
```

## Test
```bash
npm test            # Run all tests once (vitest run)
npm run test:watch  # Watch mode
```

## Type Check
```bash
npm run typecheck   # tsc --noEmit (no emit, just type-check)
```

## Publish
```bash
npm run prepack     # Runs build before pack (auto-called by npm pack/publish)
```

## Git / Utility
```bash
git status
git log --oneline
```

## Notes
- No linting script in package.json (no eslint config found)
- Test files are colocated with source: `src/**/*.test.ts`
- `vitest.config.ts` includes only `src/**/*.test.ts`
