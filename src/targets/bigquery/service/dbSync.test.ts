import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock BqClientHolder so the constructor doesn't call real BigQuery APIs
vi.mock("./bigquery", () => ({
  BqClientHolder: {
    client: () => ({
      dataset: () => ({
        table: () => ({}),
      }),
    }),
  },
}));

import { BigQueryDBSync } from "./dbSync";
import { RenameColumnStore } from "../../../sdk/models/target/renameColumnStore";
import { safeColumnName } from "../helpers";

function createSync(primaryKeys: string[] = ["pk"]) {
  const renameStore = new RenameColumnStore();
  renameStore.setSafeColumnNameConverter(safeColumnName);

  const config = {
    connector_id: "test-connector",
    database: "test-project",
    schema: "test_dataset",
    project_id: "test-project",
    loading_deck_gcs_bucket_name: "test-bucket",
  };

  const sync = new BigQueryDBSync(
    config,
    "test_stream",
    "test-project",
    "test_dataset",
    "test_table",
    renameStore
  );

  // Set up schema and primary keys manually (skip async warehouse calls)
  const flattenedSchema = {
    pk: { type: ["null", "string"] },
    name: { type: ["null", "string"] },
    amount: { type: ["null", "number"] },
    created_at: { type: ["null", "string"], format: "date-time" as const },
  };

  renameStore.computeColumnNameForStream("test_stream", flattenedSchema);
  sync.flattenedSchema = flattenedSchema;
  sync.primaryKeys = primaryKeys.map((pk) =>
    renameStore.getColumnTranslation("test_stream", pk)
  );

  return sync;
}

describe("getWarehouseTypeFromJSONSchema", () => {
  const sync = createSync();

  it("maps date-time format to TIMESTAMP", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({
        type: ["null", "string"],
        format: "date-time",
      })
    ).toBe("TIMESTAMP");
  });

  it("maps number type to NUMERIC", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({ type: ["null", "number"] })
    ).toBe("NUMERIC");
  });

  it("maps integer type to INTEGER", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({ type: ["null", "integer"] })
    ).toBe("INTEGER");
  });

  it("maps integer+string to NUMERIC", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({ type: ["integer", "string"] })
    ).toBe("NUMERIC");
  });

  it("maps boolean type to BOOLEAN", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({ type: ["null", "boolean"] })
    ).toBe("BOOLEAN");
  });

  it("maps string type to STRING", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({ type: ["null", "string"] })
    ).toBe("STRING");
  });

  it("maps array with items recursively", () => {
    expect(
      sync.getWarehouseTypeFromJSONSchema({
        type: ["array"],
        items: { type: ["number"] },
      })
    ).toBe("NUMERIC");
  });

  it("throws on unsupported type", () => {
    expect(() =>
      sync.getWarehouseTypeFromJSONSchema({ type: ["null", "object"] })
    ).toThrow(/Unsupported/);
  });
});

describe("getMergeQueries", () => {
  it("generates MERGE SQL with proper structure", () => {
    const sync = createSync();
    const queries = sync.getMergeQueries();
    expect(queries.length).toBeGreaterThanOrEqual(1);

    const sql = queries[0]!;
    expect(sql).toContain("MERGE");
    expect(sql).toContain("USING");
    expect(sql).toContain("WHEN MATCHED");
    expect(sql).toContain("WHEN NOT MATCHED");
  });

  it("includes ROW_NUMBER deduplication", () => {
    const sync = createSync();
    const queries = sync.getMergeQueries();
    const sql = queries[0]!;
    expect(sql).toContain("ROW_NUMBER()");
    expect(sql).toContain("PARTITION BY");
  });

  it("includes primary keys in SQL", () => {
    const sync = createSync();
    const queries = sync.getMergeQueries();
    const sql = queries[0]!;
    expect(sql).toContain("`pk`");
  });

  it("includes all column names", () => {
    const sync = createSync();
    const queries = sync.getMergeQueries();
    const sql = queries[0]!;
    expect(sql).toContain("`name`");
    expect(sql).toContain("`amount`");
    expect(sql).toContain("`created_at`");
  });
});

describe("getReplaceQueries", () => {
  it("starts with TRUNCATE", () => {
    const sync = createSync();
    const queries = sync.getReplaceQueries();
    expect(queries[0]).toContain("TRUNCATE TABLE");
  });

  it("follows with MERGE queries", () => {
    const sync = createSync();
    const queries = sync.getReplaceQueries();
    expect(queries.length).toBeGreaterThan(1);
    expect(queries[1]).toContain("MERGE");
  });
});

describe("getReplaceQueries without primary keys", () => {
  it("uses TRUNCATE + INSERT when no primary keys", () => {
    const sync = createSync([]);
    const queries = sync.getReplaceQueries();
    expect(queries[0]).toContain("TRUNCATE TABLE");
    expect(queries[1]).toContain("INSERT INTO");
    expect(queries[1]).not.toContain("MERGE");
  });

  it("still uses TRUNCATE + MERGE when primary keys are present", () => {
    const sync = createSync(["pk"]);
    const queries = sync.getReplaceQueries();
    expect(queries[0]).toContain("TRUNCATE TABLE");
    expect(queries[1]).toContain("MERGE");
  });
});

describe("getAppendQueries", () => {
  it("generates INSERT INTO...SELECT", () => {
    const sync = createSync();
    const queries = sync.getAppendQueries();
    expect(queries).toHaveLength(1);
    const sql = queries[0]!;
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("SELECT");
  });

  it("includes all columns", () => {
    const sync = createSync();
    const queries = sync.getAppendQueries();
    const sql = queries[0]!;
    expect(sql).toContain("`pk`");
    expect(sql).toContain("`name`");
    expect(sql).toContain("`amount`");
  });
});
