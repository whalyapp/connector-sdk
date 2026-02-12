import { describe, it, expect } from "vitest";
import {
  excelColumnToIndex,
  indexToExcelColumn,
  excelRowToIndex,
  indexToExcelRow,
  parseCellReference,
  createCellReference,
  validateExcelConfig,
  findAllMatchingConfigs,
} from "./reader";
import { ExcelExtractionConfig, ExcelSingleSheetExtractionConfig } from "../types";
import { ReplicationMethod } from "../../models/replication";

describe("excelColumnToIndex", () => {
  it("converts A to 0", () => {
    expect(excelColumnToIndex("A")).toBe(0);
  });

  it("converts Z to 25", () => {
    expect(excelColumnToIndex("Z")).toBe(25);
  });

  it("converts AA to 26", () => {
    expect(excelColumnToIndex("AA")).toBe(26);
  });

  it("converts AZ to 51", () => {
    expect(excelColumnToIndex("AZ")).toBe(51);
  });

  it("converts BA to 52", () => {
    expect(excelColumnToIndex("BA")).toBe(52);
  });

  it("is case-insensitive", () => {
    expect(excelColumnToIndex("a")).toBe(0);
    expect(excelColumnToIndex("aa")).toBe(26);
  });

  it("throws on invalid characters", () => {
    expect(() => excelColumnToIndex("1")).toThrow(/Invalid column letter/);
  });
});

describe("indexToExcelColumn", () => {
  it("converts 0 to A", () => {
    expect(indexToExcelColumn(0)).toBe("A");
  });

  it("converts 25 to Z", () => {
    expect(indexToExcelColumn(25)).toBe("Z");
  });

  it("converts 26 to AA", () => {
    expect(indexToExcelColumn(26)).toBe("AA");
  });

  it("converts 51 to AZ", () => {
    expect(indexToExcelColumn(51)).toBe("AZ");
  });

  it("converts 52 to BA", () => {
    expect(indexToExcelColumn(52)).toBe("BA");
  });

  it("throws on negative index", () => {
    expect(() => indexToExcelColumn(-1)).toThrow(/Invalid column index/);
  });
});

describe("column index roundtrip", () => {
  it.each(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"])(
    "roundtrips %s",
    (col) => {
      expect(indexToExcelColumn(excelColumnToIndex(col))).toBe(col);
    }
  );
});

describe("excelRowToIndex", () => {
  it("converts row 1 to index 0", () => {
    expect(excelRowToIndex(1)).toBe(0);
  });

  it("converts string row numbers", () => {
    expect(excelRowToIndex("5")).toBe(4);
  });

  it("throws on zero", () => {
    expect(() => excelRowToIndex(0)).toThrow(/Invalid row number/);
  });

  it("throws on negative", () => {
    expect(() => excelRowToIndex(-1)).toThrow(/Invalid row number/);
  });
});

describe("indexToExcelRow", () => {
  it("converts index 0 to row 1", () => {
    expect(indexToExcelRow(0)).toBe(1);
  });

  it("throws on negative index", () => {
    expect(() => indexToExcelRow(-1)).toThrow(/Invalid index/);
  });
});

describe("parseCellReference", () => {
  it("parses simple reference A1", () => {
    const result = parseCellReference("A1");
    expect(result).toEqual({ columnIndex: 0, rowIndex: 0 });
  });

  it("parses AA100", () => {
    const result = parseCellReference("AA100");
    expect(result).toEqual({ columnIndex: 26, rowIndex: 99 });
  });

  it("throws on invalid format", () => {
    expect(() => parseCellReference("1A")).toThrow(/Invalid cell reference/);
  });

  it("throws on lowercase letters", () => {
    expect(() => parseCellReference("a1")).toThrow(/Invalid cell reference/);
  });
});

describe("createCellReference", () => {
  it("creates A1 from (0, 0)", () => {
    expect(createCellReference(0, 0)).toBe("A1");
  });

  it("roundtrips with parseCellReference", () => {
    const ref = "AA100";
    const parsed = parseCellReference(ref);
    expect(createCellReference(parsed.columnIndex, parsed.rowIndex)).toBe(ref);
  });
});

describe("validateExcelConfig", () => {
  const baseConfig: ExcelSingleSheetExtractionConfig = {
    type: "single-sheet-extraction",
    extension: "xlsx",
    tableName: "my_table",
    fileNameValidator: () => true,
    fileNameVariablesExtractor: () => ({}),
    replicationMethod: ReplicationMethod.FULL_TABLE,
    columns: {
      col1: { type: "STRING", column: "A" },
    },
    numberOfRowsToSkip: 1,
  };

  it("accepts a valid config", () => {
    expect(() => validateExcelConfig(baseConfig)).not.toThrow();
  });

  it("throws when extension is missing", () => {
    expect(() =>
      validateExcelConfig({ ...baseConfig, extension: "" })
    ).toThrow(/Extension is required/);
  });

  it("throws when tableName is missing", () => {
    expect(() =>
      validateExcelConfig({ ...baseConfig, tableName: "" })
    ).toThrow(/Table name is required/);
  });

  it("throws on invalid column letter format", () => {
    expect(() =>
      validateExcelConfig({
        ...baseConfig,
        columns: { col1: { type: "STRING", column: "1A" } },
      })
    ).toThrow(/Invalid column letter/);
  });

  it("throws when numberOfRowsToSkip is missing", () => {
    const { numberOfRowsToSkip, ...rest } = baseConfig;
    expect(() =>
      validateExcelConfig(rest as any)
    ).toThrow(/Number of rows to skip/);
  });
});

describe("findAllMatchingConfigs", () => {
  const configs: ExcelExtractionConfig[] = [
    {
      type: "single-sheet-extraction",
      extension: "xlsx",
      tableName: "table1",
      fileNameValidator: (name) => name.startsWith("report"),
      fileNameVariablesExtractor: () => ({}),
      replicationMethod: ReplicationMethod.FULL_TABLE,
      columns: { col1: { type: "STRING", column: "A" } },
      numberOfRowsToSkip: 0,
    },
    {
      type: "single-sheet-extraction",
      extension: "csv",
      tableName: "table2",
      fileNameValidator: () => true,
      fileNameVariablesExtractor: () => ({}),
      replicationMethod: ReplicationMethod.FULL_TABLE,
      columns: { col1: { type: "STRING", column: "A" } },
      numberOfRowsToSkip: 0,
    },
  ];

  it("filters by extension and validator", () => {
    const matches = findAllMatchingConfigs("report_2024.xlsx", configs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.tableName).toBe("table1");
  });

  it("returns empty when no match", () => {
    const matches = findAllMatchingConfigs("data.xlsx", configs);
    expect(matches).toHaveLength(0);
  });

  it("matches based on extension", () => {
    const matches = findAllMatchingConfigs("anything.csv", configs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.tableName).toBe("table2");
  });
});
