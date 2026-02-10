import { describe, it, expect } from "vitest";
import { safeColumnName, safeTableName } from "./helpers";

describe("safeColumnName", () => {
  it("lowercases the input", () => {
    expect(safeColumnName("MyColumn")).toBe("mycolumn");
  });

  it("strips _TABLE_ prefix", () => {
    expect(safeColumnName("_TABLE_suffix")).toBe("suffix");
  });

  it("strips _FILE_ prefix", () => {
    expect(safeColumnName("_FILE_name")).toBe("name");
  });

  it("strips _PARTITION prefix", () => {
    expect(safeColumnName("_PARTITIONdate")).toBe("date");
  });

  it("removes leading numbers", () => {
    expect(safeColumnName("123abc")).toBe("abc");
  });

  it("removes accents", () => {
    expect(safeColumnName("résumé")).toBe("resume");
  });

  it("truncates at 300 characters", () => {
    const longName = "a".repeat(400);
    expect(safeColumnName(longName).length).toBe(300);
  });

  it("replaces special characters with underscores", () => {
    expect(safeColumnName("my-col.name!here")).toBe("my_col_name_here");
  });

  it("removes backticks", () => {
    expect(safeColumnName("`column`")).toBe("column_");
  });

  it("handles combined edge cases", () => {
    expect(safeColumnName("_TABLE_123 Héllo-World!")).toBe("hello_world_");
  });

  it("handles leading spaces and dashes", () => {
    const result = safeColumnName("  --abc");
    expect(result).toBe("abc");
  });
});

describe("safeTableName", () => {
  it("lowercases the input", () => {
    expect(safeTableName("MyTable")).toBe("mytable");
  });

  it("removes accents", () => {
    expect(safeTableName("café")).toBe("cafe");
  });

  it("truncates at 1024 characters", () => {
    const longName = "t".repeat(1100);
    expect(safeTableName(longName).length).toBe(1024);
  });

  it("does NOT strip _TABLE_ prefix", () => {
    expect(safeTableName("_TABLE_suffix")).toBe("_table_suffix");
  });

  it("does NOT strip leading numbers", () => {
    expect(safeTableName("123abc")).toBe("123abc");
  });

  it("replaces special characters with underscores", () => {
    expect(safeTableName("my-table.name")).toBe("my_table_name");
  });
});
