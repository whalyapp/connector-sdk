import { describe, it, expect } from "vitest";
import { FilePatterns, VariableExtractors } from "./file-patterns";

describe("FilePatterns", () => {
  describe("startsWith", () => {
    it("matches when filename starts with prefix", () => {
      const matcher = FilePatterns.startsWith("report");
      expect(matcher("report_2024.xlsx")).toBe(true);
    });

    it("is case-insensitive", () => {
      const matcher = FilePatterns.startsWith("Report");
      expect(matcher("report_2024.xlsx")).toBe(true);
      expect(matcher("REPORT_2024.xlsx")).toBe(true);
    });

    it("rejects non-matching filenames", () => {
      const matcher = FilePatterns.startsWith("report");
      expect(matcher("data_2024.xlsx")).toBe(false);
    });
  });

  describe("regex", () => {
    it("matches regex pattern", () => {
      const matcher = FilePatterns.regex(/^data_\d{4}\.csv$/);
      expect(matcher("data_2024.csv")).toBe(true);
    });

    it("rejects non-matching pattern", () => {
      const matcher = FilePatterns.regex(/^data_\d{4}\.csv$/);
      expect(matcher("report_2024.csv")).toBe(false);
    });
  });

  describe("and", () => {
    it("requires all validators to pass", () => {
      const matcher = FilePatterns.and(
        FilePatterns.startsWith("report"),
        FilePatterns.regex(/\.xlsx$/)
      );
      expect(matcher("report_2024.xlsx")).toBe(true);
      expect(matcher("report_2024.csv")).toBe(false);
      expect(matcher("data_2024.xlsx")).toBe(false);
    });
  });

  describe("or", () => {
    it("requires at least one validator to pass", () => {
      const matcher = FilePatterns.or(
        FilePatterns.startsWith("report"),
        FilePatterns.startsWith("data")
      );
      expect(matcher("report_2024.xlsx")).toBe(true);
      expect(matcher("data_2024.xlsx")).toBe(true);
      expect(matcher("other.xlsx")).toBe(false);
    });
  });
});

describe("VariableExtractors", () => {
  describe("filename", () => {
    it("returns filename as a variable", () => {
      const extractor = VariableExtractors.filename();
      expect(extractor("report_2024.xlsx")).toEqual({
        fileName: "report_2024.xlsx",
      });
    });
  });

  describe("regex", () => {
    it("extracts named capture groups", () => {
      const extractor = VariableExtractors.regex(
        /^report_(?<year>\d{4})_(?<month>\d{2})\.xlsx$/
      );
      const result = extractor("report_2024_06.xlsx");
      expect(result.year).toBe("2024");
      expect(result.month).toBe("06");
    });

    it("returns empty object when no match", () => {
      const extractor = VariableExtractors.regex(/^data_(?<id>\d+)\.csv$/);
      expect(extractor("report.xlsx")).toEqual({});
    });
  });

  describe("combine", () => {
    it("merges results from multiple extractors", () => {
      const extractor = VariableExtractors.combine(
        VariableExtractors.filename(),
        VariableExtractors.regex(/^report_(?<year>\d{4})/)
      );
      const result = extractor("report_2024.xlsx");
      expect(result.fileName).toBe("report_2024.xlsx");
      expect(result.year).toBe("2024");
    });
  });
});
