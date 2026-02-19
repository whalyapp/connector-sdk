import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getServiceAccountKey } from "./serviceAccountKey";

describe("getServiceAccountKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.WLY_SERVICE_ACCOUNT_KEY;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("returns the explicit key when provided", () => {
        expect(getServiceAccountKey("sk:explicit")).toBe("sk:explicit");
    });

    it("returns the explicit key even when env var is set", () => {
        process.env.WLY_SERVICE_ACCOUNT_KEY = "sk:env";
        expect(getServiceAccountKey("sk:explicit")).toBe("sk:explicit");
    });

    it("falls back to WLY_SERVICE_ACCOUNT_KEY env var when explicit key is omitted", () => {
        process.env.WLY_SERVICE_ACCOUNT_KEY = "sk:env";
        expect(getServiceAccountKey()).toBe("sk:env");
    });

    it("falls back to env var when explicit key is undefined", () => {
        process.env.WLY_SERVICE_ACCOUNT_KEY = "sk:env";
        expect(getServiceAccountKey(undefined)).toBe("sk:env");
    });

    it("throws with a clear message when neither explicit key nor env var is available", () => {
        expect(() => getServiceAccountKey()).toThrowError(
            /No service account key provided.*WLY_SERVICE_ACCOUNT_KEY/
        );
    });
});
