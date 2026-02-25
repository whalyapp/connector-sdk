import { describe, it, expect, beforeEach } from "vitest";

describe("WhalyDocumentTarget", () => {
    beforeEach(() => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
    });

    it("constructs without error", async () => {
        const { WhalyDocumentTarget } = await import("./whaly-document-target");
        const target = new WhalyDocumentTarget({ objectStorageId: "objst_test" });
        expect(target.config.objectStorageId).toBe("objst_test");
    });
});
