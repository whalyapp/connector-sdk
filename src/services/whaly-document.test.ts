import { describe, it, expect, beforeEach } from "vitest";

describe("WhalyDocumentService", () => {
    beforeEach(() => {
        process.env["WLY_API_ENDPOINT"] = "https://test.whaly.io";
        process.env["WLY_SERVICE_ACCOUNT_KEY"] = "sk:test-key";
    });

    it("constructs without error when env vars are set", async () => {
        const { WhalyDocumentService } = await import("./whaly-document");
        const service = new WhalyDocumentService({ objectStorageId: "objst_test" });
        expect(service.objectStorageId).toBe("objst_test");
    });
});
