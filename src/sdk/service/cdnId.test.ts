import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCdnId } from "./cdnId";

describe("getCdnId", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.WLY_CDN_ID;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("returns the explicit CDN ID when provided", () => {
        expect(getCdnId("cdn-123")).toBe("cdn-123");
    });

    it("returns the explicit CDN ID even when env var is set", () => {
        process.env.WLY_CDN_ID = "cdn-from-env";
        expect(getCdnId("cdn-explicit")).toBe("cdn-explicit");
    });

    it("falls back to WLY_CDN_ID env var when explicit CDN ID is omitted", () => {
        process.env.WLY_CDN_ID = "cdn-from-env";
        expect(getCdnId()).toBe("cdn-from-env");
    });

    it("falls back to env var when explicit CDN ID is undefined", () => {
        process.env.WLY_CDN_ID = "cdn-from-env";
        expect(getCdnId(undefined)).toBe("cdn-from-env");
    });

    it("throws with a clear message when neither explicit CDN ID nor env var is available", () => {
        expect(() => getCdnId()).toThrowError(
            /No CDN ID provided.*WLY_CDN_ID/
        );
    });
});
