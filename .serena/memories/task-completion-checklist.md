# Task Completion Checklist

When finishing a task in connector-sdk:

1. **Type check**: `npm run typecheck` — must pass with no errors
2. **Run tests**: `npm test` — all tests must pass
3. **Build** (if touching public API or dist-affecting code): `npm run build`
4. **No linter** — no eslint/prettier configured, follow existing code style manually

## Notes
- Strict TypeScript: check for `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` issues
- Tests are colocated with source (`*.test.ts`)
- No auto-formatting step; match surrounding code style
