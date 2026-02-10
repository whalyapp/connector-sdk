import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { validateDateRange, convertNumberIntoDecimal, maxBQNumericValue } from "./record";
import { FlattenedSchema } from "../../../sdk/models/target/models";

describe("validateDateRange", () => {
  const schema: FlattenedSchema = {
    created_at: { type: ["null", "string"], format: "date-time" },
    name: { type: ["null", "string"] },
  };

  it("formats a valid date within range", () => {
    const record = { created_at: "2024-06-15T12:00:00Z", name: "test" };
    const result = validateDateRange(record, schema);
    expect(result.created_at).toContain("2024-06-15");
  });

  it("nullifies dates before 0001-01-01", () => {
    const record = { created_at: "0000-01-01T00:00:00Z", name: "test" };
    const result = validateDateRange(record, schema);
    expect(result.created_at).toBeUndefined();
  });

  it("nullifies dates after 9999-12-31", () => {
    const record = { created_at: "10000-01-01T00:00:00Z", name: "test" };
    const result = validateDateRange(record, schema);
    expect(result.created_at).toBeUndefined();
  });

  it("passes through non-datetime fields untouched", () => {
    const record = { created_at: "2024-06-15T12:00:00Z", name: "hello" };
    const result = validateDateRange(record, schema);
    expect(result.name).toBe("hello");
  });

  it("nullifies 'Invalid date' strings", () => {
    const record = { created_at: "not-a-date", name: "test" };
    const result = validateDateRange(record, schema);
    expect(result.created_at).toBeUndefined();
  });

  it("skips falsy values for datetime fields", () => {
    const record = { created_at: null, name: "test" };
    const result = validateDateRange(record, schema);
    expect(result.created_at).toBeNull();
  });
});

describe("convertNumberIntoDecimal", () => {
  const schema: FlattenedSchema = {
    amount: { type: ["null", "number"] },
    name: { type: ["null", "string"] },
    scores: { type: ["null", "array"], items: { type: ["number"] } },
  };

  it("converts a number to Decimal with 9 decimal places", () => {
    const record = { amount: 42.123456789012, name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.amount).toBeInstanceOf(Decimal);
    // Decimal places should be at most 9
    expect(result.amount.decimalPlaces()).toBeLessThanOrEqual(9);
  });

  it("nullifies values at or above BQ max numeric", () => {
    const record = { amount: 1e29, name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.amount).toBeNull();
  });

  it("keeps values below BQ max", () => {
    const record = { amount: 1e28, name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.amount).toBeInstanceOf(Decimal);
  });

  it("handles arrays of numbers", () => {
    const record = { scores: [1.5, 2.5, 3.5], name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.scores).toHaveLength(3);
    expect(result.scores[0]).toBeInstanceOf(Decimal);
  });

  it("filters out over-limit values in arrays", () => {
    const record = { scores: [1.5, 1e29], name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.scores).toHaveLength(1);
  });

  it("nullifies non-numeric values for number fields", () => {
    const record = { amount: "not-a-number", name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.amount).toBeNull();
  });

  it("does not touch string fields", () => {
    const record = { amount: 10, name: "hello" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.name).toBe("hello");
  });

  it("handles Decimal input values", () => {
    const record = { amount: new Decimal("42.5"), name: "test" };
    const result = convertNumberIntoDecimal(record, schema);
    expect(result.amount).toBeInstanceOf(Decimal);
  });
});
