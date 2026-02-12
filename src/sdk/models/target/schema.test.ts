import { describe, it, expect, vi } from "vitest";

vi.mock("../../service/exit", () => ({
  gracefulExit: vi.fn(),
}));

import { flattenSchema } from "./schema";

describe("flattenSchema", () => {
  it("extracts type, format, and items from properties", () => {
    const schema = {
      properties: {
        name: { type: "string" },
        created_at: { type: "string", format: "date-time" },
        scores: { type: "array", items: { type: "number" } },
      },
    };
    const result = flattenSchema("stream1", schema);
    expect(result.name).toEqual({
      type: "string",
      format: undefined,
      items: undefined,
    });
    expect(result.created_at).toEqual({
      type: "string",
      format: "date-time",
      items: undefined,
    });
    expect(result.scores).toEqual({
      type: "array",
      format: undefined,
      items: { type: "number" },
    });
  });

  it("returns empty object when no properties", () => {
    expect(flattenSchema("stream1", {})).toEqual({});
    expect(flattenSchema("stream1", { type: "object" })).toEqual({});
  });

  it("calls gracefulExit on error (missing type field)", async () => {
    const { gracefulExit } = await import("../../service/exit");
    const schema = {
      properties: {
        broken: { format: "date-time" },
      },
    };
    flattenSchema("stream1", schema);
    expect(gracefulExit).toHaveBeenCalledWith(1);
  });

  it("skips null property schemas", () => {
    const schema = {
      properties: {
        valid: { type: "string" },
        empty: null,
      },
    };
    const result = flattenSchema("stream1", schema);
    expect(result.valid).toBeDefined();
    expect(result.empty).toBeUndefined();
  });
});
