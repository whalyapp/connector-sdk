import { describe, it, expect, afterEach } from "vitest";
import { getDryRunLimit } from "./dryRun";

describe("getDryRunLimit", () => {
    afterEach(() => { delete process.env["DRY_RUN_LIMIT"]; });

    it("returns undefined when DRY_RUN_LIMIT is not set", () => {
        expect(getDryRunLimit()).toBeUndefined();
    });

    it("returns the parsed number when DRY_RUN_LIMIT is a positive integer", () => {
        process.env["DRY_RUN_LIMIT"] = "5";
        expect(getDryRunLimit()).toBe(5);
    });

    it("returns undefined when DRY_RUN_LIMIT is 0", () => {
        process.env["DRY_RUN_LIMIT"] = "0";
        expect(getDryRunLimit()).toBeUndefined();
    });

    it("returns undefined when DRY_RUN_LIMIT is not a number", () => {
        process.env["DRY_RUN_LIMIT"] = "abc";
        expect(getDryRunLimit()).toBeUndefined();
    });
});
