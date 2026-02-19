import { describe, it, expect } from "vitest";
import { removeParasiteProperties, addWhalyFields } from "./record";
import { DEFAULT_SYNCED_AT_COLUMN, FlattenedSchema } from "./models";

describe("removeParasiteProperties", () => {
  const schema: FlattenedSchema = {
    id: { type: "string" },
    name: { type: "string" },
  };

  it("strips fields not in schema", () => {
    const record = { id: "1", name: "test", extra: "remove-me" };
    const result = removeParasiteProperties(record, schema);
    expect(result.extra).toBeUndefined();
    expect(result.id).toBe("1");
    expect(result.name).toBe("test");
  });

  it("keeps all schema fields", () => {
    const record = { id: "1", name: "test" };
    const result = removeParasiteProperties(record, schema);
    expect(Object.keys(result)).toEqual(["id", "name"]);
  });

  it("handles records with only parasite properties", () => {
    const record = { foo: "bar", baz: "qux" };
    const result = removeParasiteProperties(record, schema);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("addWhalyFields", () => {
  it("adds _wly_synced_at field by default", () => {
    const record = { id: "1" };
    const batchDate = "2024-06-15T12:00:00Z";
    const result = addWhalyFields(record, batchDate);
    expect(result[DEFAULT_SYNCED_AT_COLUMN]).toBe(batchDate);
    expect(result.id).toBe("1");
  });

  it("uses custom column name when provided", () => {
    const record = { id: "1" };
    const batchDate = "2024-06-15T12:00:00Z";
    const result = addWhalyFields(record, batchDate, "synced_at");
    expect(result.synced_at).toBe(batchDate);
    expect(result[DEFAULT_SYNCED_AT_COLUMN]).toBeUndefined();
    expect(result.id).toBe("1");
  });

  it("does not mutate the original record", () => {
    const record = { id: "1" };
    addWhalyFields(record, "2024-06-15T12:00:00Z");
    expect((record as any)[DEFAULT_SYNCED_AT_COLUMN]).toBeUndefined();
  });
});
