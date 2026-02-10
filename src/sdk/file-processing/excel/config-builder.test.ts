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
});
