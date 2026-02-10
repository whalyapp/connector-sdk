import { describe, it, expect } from "vitest";
import { RenameColumnStore } from "./renameColumnStore";
import { FlattenedSchema } from "./models";

const identity = (s: string) => s;
const toLower = (s: string) => s.toLowerCase();

describe("RenameColumnStore", () => {
  describe("basic mapping", () => {
    it("maps columns using the safe name converter", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(toLower);
      const schema: FlattenedSchema = {
        MyColumn: { type: "string" },
      };
      store.computeColumnNameForStream("s1", schema);
      expect(store.getColumnTranslation("s1", "MyColumn")).toBe("mycolumn");
    });

    it("handles identity converter", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(identity);
      const schema: FlattenedSchema = {
        col_a: { type: "string" },
        col_b: { type: "number" },
      };
      store.computeColumnNameForStream("s1", schema);
      expect(store.getColumnTranslation("s1", "col_a")).toBe("col_a");
      expect(store.getColumnTranslation("s1", "col_b")).toBe("col_b");
    });
  });

  describe("collision resolution", () => {
    it("adds _1 suffix for two-way collision", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(toLower);
      const schema: FlattenedSchema = {
        HELLO: { type: "string" },
        Hello: { type: "string" },
      };
      store.computeColumnNameForStream("s1", schema);
      // Sorted order: HELLO, Hello — first gets "hello", second gets "hello_1"
      expect(store.getColumnTranslation("s1", "HELLO")).toBe("hello");
      expect(store.getColumnTranslation("s1", "Hello")).toBe("hello_1");
    });

    it("adds _1 and _2 suffixes for three-way collision", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(toLower);
      const schema: FlattenedSchema = {
        ABC: { type: "string" },
        Abc: { type: "string" },
        abc: { type: "string" },
      };
      store.computeColumnNameForStream("s1", schema);
      // Sorted: ABC, Abc, abc
      expect(store.getColumnTranslation("s1", "ABC")).toBe("abc");
      expect(store.getColumnTranslation("s1", "Abc")).toBe("abc_1");
      expect(store.getColumnTranslation("s1", "abc")).toBe("abc_2");
    });
  });

  describe("getColumnTranslation", () => {
    it("returns the correct safe name", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(identity);
      const schema: FlattenedSchema = { foo: { type: "string" } };
      store.computeColumnNameForStream("s1", schema);
      expect(store.getColumnTranslation("s1", "foo")).toBe("foo");
    });

    it("throws when stream is not initialized", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(identity);
      expect(() => store.getColumnTranslation("unknown", "col")).toThrow(
        /not initialized/
      );
    });

    it("throws when column is unknown", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(identity);
      const schema: FlattenedSchema = { foo: { type: "string" } };
      store.computeColumnNameForStream("s1", schema);
      expect(() => store.getColumnTranslation("s1", "bar")).toThrow(
        /No renamed value/
      );
    });
  });

  describe("isReady", () => {
    it("returns false before computeColumnNameForStream", () => {
      const store = new RenameColumnStore();
      expect(store.isReady("s1")).toBe(false);
    });

    it("returns true after computeColumnNameForStream", () => {
      const store = new RenameColumnStore();
      store.setSafeColumnNameConverter(identity);
      const schema: FlattenedSchema = { col: { type: "string" } };
      store.computeColumnNameForStream("s1", schema);
      expect(store.isReady("s1")).toBe(true);
    });
  });

  it("throws if safeColumnNameConverter is not set", () => {
    const store = new RenameColumnStore();
    const schema: FlattenedSchema = { col: { type: "string" } };
    expect(() => store.computeColumnNameForStream("s1", schema)).toThrow(
      /safeColumnNameConverter is not defined/
    );
  });
});
