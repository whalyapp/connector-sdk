import { describe, it, expect } from "vitest";
import {
  fieldTypeToJsonSchema,
  excelFieldsToJsonSchema,
  csvFieldsToJsonSchema,
  extractPrimaryKeysFromCsvConfig,
  extractPrimaryKeysFromExcelFields,
} from "./schema-utils";
import { ExcelFieldMapping, CsvFieldsArrayConfig, CsvFieldsDictConfig } from "./types";

describe("fieldTypeToJsonSchema", () => {
  it("maps STRING to nullable string", () => {
    expect(fieldTypeToJsonSchema("STRING")).toEqual({
      type: ["null", "string"],
    });
  });

  it("maps FLOAT to nullable number", () => {
    expect(fieldTypeToJsonSchema("FLOAT")).toEqual({
      type: ["null", "number"],
    });
  });

  it("maps TIMESTAMP to nullable string with date-time format", () => {
    expect(fieldTypeToJsonSchema("TIMESTAMP")).toEqual({
      type: ["null", "string"],
      format: "date-time",
    });
  });

  it("falls back to nullable string for unknown types", () => {
    expect(fieldTypeToJsonSchema("UNKNOWN" as any)).toEqual({
      type: ["null", "string"],
    });
  });
});

describe("excelFieldsToJsonSchema", () => {
  it("converts source column fields", () => {
    const fields: ExcelFieldMapping = {
      name: { type: "STRING", column: "A" },
      amount: { type: "FLOAT", column: "B" },
    };
    const result = excelFieldsToJsonSchema(fields);
    expect(result.type).toBe("object");
    expect(result.properties.name).toEqual({ type: ["null", "string"] });
    expect(result.properties.amount).toEqual({ type: ["null", "number"] });
  });

  it("converts derived fields", () => {
    const fields: ExcelFieldMapping = {
      filename: { type: "STRING", variableName: "fileName" },
    };
    const result = excelFieldsToJsonSchema(fields);
    expect(result.properties.filename).toEqual({ type: ["null", "string"] });
  });
});

describe("csvFieldsToJsonSchema", () => {
  it("handles array config format", () => {
    const config: CsvFieldsArrayConfig = [
      { key: "id", type: "STRING" },
      { key: "value", type: "FLOAT" },
    ];
    const result = csvFieldsToJsonSchema(config);
    expect(result.type).toBe("object");
    expect(result.properties.id).toEqual({ type: ["null", "string"] });
    expect(result.properties.value).toEqual({ type: ["null", "number"] });
  });

  it("handles dict config format", () => {
    const config: CsvFieldsDictConfig = {
      col1: { key: "id", type: "STRING" },
      col2: { key: "ts", type: "TIMESTAMP" },
    };
    const result = csvFieldsToJsonSchema(config);
    expect(result.properties.id).toEqual({ type: ["null", "string"] });
    expect(result.properties.ts).toEqual({
      type: ["null", "string"],
      format: "date-time",
    });
  });
});

describe("extractPrimaryKeysFromCsvConfig", () => {
  it("extracts keys from array config", () => {
    const config: CsvFieldsArrayConfig = [
      { key: "id", type: "STRING" },
      { key: "name", type: "STRING" },
    ];
    expect(extractPrimaryKeysFromCsvConfig(config)).toEqual(["id", "name"]);
  });

  it("extracts keys from dict config", () => {
    const config: CsvFieldsDictConfig = {
      col1: { key: "id", type: "STRING" },
      col2: { key: "name", type: "STRING" },
    };
    expect(extractPrimaryKeysFromCsvConfig(config)).toEqual(["id", "name"]);
  });
});

describe("extractPrimaryKeysFromExcelFields", () => {
  it("extracts primary keys from source columns", () => {
    const fields: ExcelFieldMapping = {
      id: { type: "STRING", column: "A", primaryKey: true },
      name: { type: "STRING", column: "B" },
    };
    expect(extractPrimaryKeysFromExcelFields(fields)).toEqual(["id"]);
  });

  it("extracts primary keys from derived fields", () => {
    const fields: ExcelFieldMapping = {
      filename: { type: "STRING", variableName: "fileName", primaryKey: true },
      value: { type: "FLOAT", column: "A" },
    };
    expect(extractPrimaryKeysFromExcelFields(fields)).toEqual(["filename"]);
  });

  it("returns empty array when no primary keys", () => {
    const fields: ExcelFieldMapping = {
      col1: { type: "STRING", column: "A" },
    };
    expect(extractPrimaryKeysFromExcelFields(fields)).toEqual([]);
  });
});
