# Migration Guide: 0.1.1 → 0.2.0

This guide will help you migrate your code from version 0.1.1 to 0.2.0 of the connector SDK.

## Breaking Changes

### 1. Date Library: moment → dayjs

The SDK has migrated from `moment` to `dayjs` for date/time operations.

**Before (0.1.1):**
```typescript
import moment from "moment";
const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
```

**After (0.2.0):**
```typescript
import dayjs from "dayjs";
const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
```

**Action Required:**
- Update any imports from `moment` to `dayjs`
- Replace `moment()` calls with `dayjs()`
- Note: `dayjs` has a similar API to `moment` but is immutable by default

### 2. Removed Resolver System

The resolver system has been completely removed from the SDK.

**Before (0.1.1):**
```typescript
import { Resolver } from "@whaly/connector-sdk";
import { LocalFileResolver } from "@whaly/connector-sdk/resolvers/local-file";
```

**After (0.2.0):**
- Resolver functionality is no longer available

**Action Required:**
- Remove all imports related to resolvers
- Remove any resolver-related code from your implementation

### 3. Catalog and Models Module Changes

**Before (0.1.1):**
```typescript
import { StreamId } from "@whaly/connector-sdk/models/catalog";
import { ReplicationMethod } from "@whaly/connector-sdk/models/models";
```

**After (0.2.0):**
```typescript
import { StreamId } from "@whaly/connector-sdk/models/metadata";
import { ReplicationMethod } from "@whaly/connector-sdk/models/replication";
```

**Action Required:**
- Update imports: `StreamId` is now exported from `metadata` module
- Update imports: `ReplicationMethod` is now exported from `replication` module
