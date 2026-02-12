import { describe, it, expect } from "vitest";
import { isDatetimeType } from "./typing";

describe("isDatetimeType", () => {
  it("returns true for direct date-time format", () => {
    expect(
      isDatetimeType({ type: "string", format: "date-time" })
    ).toBe(true);
  });

  it("returns false when format is not date-time", () => {
    expect(isDatetimeType({ type: "string" })).toBe(false);
  });

  it("returns true when date-time is nested in anyOf", () => {
    expect(
      isDatetimeType({
        anyOf: [
          { type: "null" },
          { type: "string", format: "date-time" },
        ],
        type: "string",
      })
    ).toBe(true);
  });

  it("returns false when anyOf has no date-time", () => {
    expect(
      isDatetimeType({
        anyOf: [{ type: "null" }, { type: "string" }],
        type: "string",
      })
    ).toBe(false);
  });

  it("throws on empty/null input", () => {
    expect(() => isDatetimeType(null as any)).toThrow(
      /empty typeDef/
    );
    expect(() => isDatetimeType(undefined as any)).toThrow(
      /empty typeDef/
    );
  });

  it("returns false for number type without format", () => {
    expect(isDatetimeType({ type: "number" })).toBe(false);
  });
});
