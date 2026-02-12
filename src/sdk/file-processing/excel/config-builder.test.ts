import { describe, it, expect } from "vitest";
import { ExcelExtractionConfigBuilder } from "./config-builder";
import { ReplicationMethod } from "../../models/replication";

describe("ExcelExtractionConfigBuilder", () => {
  it("builds a valid single-sheet config", () => {
    const config = ExcelExtractionConfigBuilder.create()
      .extension("xlsx")
      .tableName("my_table")
      .fileValidator(() => true)
      .variablesExtractor(() => ({}))
      .replicationMethod(ReplicationMethod.FULL_TABLE)
      .singleSheet("Sheet1", 1)
      .columns({
        name: { type: "STRING", column: "A" },
      })
      .build();

    expect(config.type).toBe("single-sheet-extraction");
    expect(config.extension).toBe("xlsx");
    expect(config.tableName).toBe("my_table");
  });

  it("builds a valid processor config", () => {
    const config = ExcelExtractionConfigBuilder.create()
      .extension("xlsx")
      .tableName("my_table")
      .fileValidator(() => true)
      .variablesExtractor(() => ({}))
      .replicationMethod(ReplicationMethod.FULL_TABLE)
      .processor(async () => [])
      .build();

    expect(config.type).toBe("processor");
  });

  it("throws when type is not set", () => {
    expect(() =>
      ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .build()
    ).toThrow(/type must be specified/);
  });

  it("throws when columns() called for non-single-sheet", () => {
    expect(() =>
      ExcelExtractionConfigBuilder.create()
        .processor(async () => [])
        .columns({ col: { type: "STRING", column: "A" } })
    ).toThrow(/only be set for single-sheet/);
  });

  it("uses default skipRows of 0", () => {
    const config = ExcelExtractionConfigBuilder.create()
      .extension("xlsx")
      .tableName("my_table")
      .fileValidator(() => true)
      .variablesExtractor(() => ({}))
      .replicationMethod(ReplicationMethod.FULL_TABLE)
      .singleSheet()
      .columns({ name: { type: "STRING", column: "A" } })
      .build();

    expect(config.type).toBe("single-sheet-extraction");
    if (config.type === "single-sheet-extraction") {
      expect(config.numberOfRowsToSkip).toBe(0);
    }
  });

  describe("sensible defaults", () => {
    it("defaults fileNameValidator to accept all files", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.fileNameValidator("anything.xlsx")).toBe(true);
      expect(config.fileNameValidator("")).toBe(true);
    });

    it("defaults fileNameVariablesExtractor to return empty object", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.fileNameVariablesExtractor("test.xlsx")).toEqual({});
    });

    it("defaults replicationMethod to FULL_TABLE", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.replicationMethod).toBe(ReplicationMethod.FULL_TABLE);
    });
  });

  describe("override defaults", () => {
    it("explicit fileValidator overrides default", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .fileValidator((name) => name.endsWith(".xlsx"))
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.fileNameValidator("test.xlsx")).toBe(true);
      expect(config.fileNameValidator("test.csv")).toBe(false);
    });

    it("explicit variablesExtractor overrides default", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .variablesExtractor((name) => ({ year: "2024" }))
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.fileNameVariablesExtractor("report_2024.xlsx")).toEqual({ year: "2024" });
    });

    it("explicit replicationMethod overrides default", () => {
      const config = ExcelExtractionConfigBuilder.create()
        .extension("xlsx")
        .tableName("my_table")
        .replicationMethod(ReplicationMethod.INCREMENTAL)
        .singleSheet()
        .columns({ name: { type: "STRING", column: "A" } })
        .build();

      expect(config.replicationMethod).toBe(ReplicationMethod.INCREMENTAL);
    });
  });

  describe("validation", () => {
    it("throws when extension is not set", () => {
      expect(() =>
        ExcelExtractionConfigBuilder.create()
          .tableName("my_table")
          .singleSheet()
          .columns({ name: { type: "STRING", column: "A" } })
          .build()
      ).toThrow(/Extension must be set/);
    });

    it("throws when tableName is not set", () => {
      expect(() =>
        ExcelExtractionConfigBuilder.create()
          .extension("xlsx")
          .singleSheet()
          .columns({ name: { type: "STRING", column: "A" } })
          .build()
      ).toThrow(/Table name must be set/);
    });

    it("throws when columns are missing for single-sheet-extraction", () => {
      expect(() =>
        ExcelExtractionConfigBuilder.create()
          .extension("xlsx")
          .tableName("my_table")
          .singleSheet()
          .build()
      ).toThrow(/Columns must be set with at least one column/);
    });

    it("throws when columns are empty for single-sheet-extraction", () => {
      expect(() =>
        ExcelExtractionConfigBuilder.create()
          .extension("xlsx")
          .tableName("my_table")
          .singleSheet()
          .columns({})
          .build()
      ).toThrow(/Columns must be set with at least one column/);
    });
  });
});
