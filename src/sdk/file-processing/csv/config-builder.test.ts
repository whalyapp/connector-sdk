import { describe, it, expect } from "vitest";
import { CsvExtractionConfigBuilder } from "./config-builder";
import { ReplicationMethod } from "../../models/replication";
import { FileFormat } from "../types";

describe("CsvExtractionConfigBuilder", () => {
  describe("fieldsFromDict", () => {
    it("builds a config with dict-style fields", () => {
      const config = CsvExtractionConfigBuilder.create()
        .fieldsFromDict({
          "Product ID": { key: "product_id", type: "STRING" },
          "Price":      { key: "price",      type: "FLOAT" },
        })
        .build();

      expect(config.separator).toBe(",");
      expect(config.fields).toEqual({
        "Product ID": { key: "product_id", type: "STRING" },
        "Price":      { key: "price",      type: "FLOAT" },
      });
      expect(config.encoding).toBeUndefined();
      expect(config.addSyncedAtColumn).toBeUndefined();
    });
  });

  describe("fieldsFromArray", () => {
    it("builds a config with array-style fields", () => {
      const config = CsvExtractionConfigBuilder.create()
        .fieldsFromArray([
          { key: "col_a", type: "STRING" },
          { key: "col_b", type: "FLOAT" },
        ])
        .build();

      expect(Array.isArray(config.fields)).toBe(true);
      expect(config.fields).toHaveLength(2);
    });
  });

  describe("custom separator and encoding", () => {
    it("applies custom separator", () => {
      const config = CsvExtractionConfigBuilder.create()
        .separator(";")
        .fieldsFromDict({ "Col": { key: "col", type: "STRING" } })
        .build();

      expect(config.separator).toBe(";");
    });

    it("applies custom encoding", () => {
      const config = CsvExtractionConfigBuilder.create()
        .encoding("latin1")
        .fieldsFromDict({ "Col": { key: "col", type: "STRING" } })
        .build();

      expect(config.encoding).toBe("latin1");
    });
  });

  describe("addSyncedAtColumn", () => {
    it("enables synced-at column by default", () => {
      const config = CsvExtractionConfigBuilder.create()
        .addSyncedAtColumn()
        .fieldsFromDict({ "Col": { key: "col", type: "STRING" } })
        .build();

      expect(config.addSyncedAtColumn).toBe(true);
    });

    it("can be explicitly disabled", () => {
      const config = CsvExtractionConfigBuilder.create()
        .addSyncedAtColumn(false)
        .fieldsFromDict({ "Col": { key: "col", type: "STRING" } })
        .build();

      expect(config.addSyncedAtColumn).toBe(false);
    });
  });

  describe("buildStreamConfig", () => {
    it("creates a FileStreamConfig with defaults", () => {
      const streamConfig = CsvExtractionConfigBuilder.create()
        .fieldsFromDict({
          "ID":   { key: "id",   type: "STRING" },
          "Name": { key: "name", type: "STRING" },
        })
        .buildStreamConfig("my_stream");

      expect(streamConfig.format).toBe(FileFormat.CSV);
      expect(streamConfig.streamId).toBe("my_stream");
      expect(streamConfig.replicationMethod).toBe(ReplicationMethod.FULL_TABLE);
    });

    it("uses custom replicationMethod and primaryKeys", () => {
      const streamConfig = CsvExtractionConfigBuilder.create()
        .fieldsFromDict({
          "ID":   { key: "id",   type: "STRING" },
          "Name": { key: "name", type: "STRING" },
        })
        .replicationMethod(ReplicationMethod.INCREMENTAL)
        .primaryKeys(["id"])
        .buildStreamConfig("my_stream");

      expect(streamConfig.replicationMethod).toBe(ReplicationMethod.INCREMENTAL);
      expect(streamConfig.primaryKeys).toEqual(["id"]);
    });
  });

  describe("validation errors", () => {
    it("throws when fields are not set", () => {
      expect(() =>
        CsvExtractionConfigBuilder.create().build()
      ).toThrow(/Fields must be configured/);
    });

    it("throws when dict-style fields are empty", () => {
      expect(() =>
        CsvExtractionConfigBuilder.create()
          .fieldsFromDict({})
          .build()
      ).toThrow(/Fields must not be empty/);
    });

    it("throws when array-style fields are empty", () => {
      expect(() =>
        CsvExtractionConfigBuilder.create()
          .fieldsFromArray([])
          .build()
      ).toThrow(/Fields must not be empty/);
    });

    it("throws when fieldsFromDict called after fieldsFromArray", () => {
      expect(() =>
        CsvExtractionConfigBuilder.create()
          .fieldsFromArray([{ key: "a", type: "STRING" }])
          .fieldsFromDict({ "A": { key: "a", type: "STRING" } })
      ).toThrow(/Cannot use fieldsFromDict after fieldsFromArray/);
    });

    it("throws when fieldsFromArray called after fieldsFromDict", () => {
      expect(() =>
        CsvExtractionConfigBuilder.create()
          .fieldsFromDict({ "A": { key: "a", type: "STRING" } })
          .fieldsFromArray([{ key: "a", type: "STRING" }])
      ).toThrow(/Cannot use fieldsFromArray after fieldsFromDict/);
    });
  });
});
