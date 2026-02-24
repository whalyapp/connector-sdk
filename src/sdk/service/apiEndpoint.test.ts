import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getApiEndpoint } from "./apiEndpoint";

describe("getApiEndpoint", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.WLY_API_ENDPOINT;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("returns the explicit endpoint when provided", () => {
        expect(getApiEndpoint("https://explicit.whaly.io")).toBe("https://explicit.whaly.io");
    });

    it("returns the explicit endpoint even when env var is set", () => {
        process.env.WLY_API_ENDPOINT = "https://env.whaly.io";
        expect(getApiEndpoint("https://explicit.whaly.io")).toBe("https://explicit.whaly.io");
    });

    it("falls back to WLY_API_ENDPOINT env var when explicit endpoint is omitted", () => {
        process.env.WLY_API_ENDPOINT = "https://env.whaly.io";
        expect(getApiEndpoint()).toBe("https://env.whaly.io");
    });

    it("falls back to env var when explicit endpoint is undefined", () => {
        process.env.WLY_API_ENDPOINT = "https://env.whaly.io";
        expect(getApiEndpoint(undefined)).toBe("https://env.whaly.io");
    });

    it("throws with a clear message when neither explicit endpoint nor env var is available", () => {
        expect(() => getApiEndpoint()).toThrowError(
            /No API endpoint provided.*WLY_API_ENDPOINT/
        );
    });
});
