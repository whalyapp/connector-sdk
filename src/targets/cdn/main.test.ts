import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these are available before vi.mock factory hoisting
const { mockGetFileMetadata, mockUploadFile, mockReadFile } = vi.hoisted(() => ({
    mockGetFileMetadata: vi.fn(),
    mockUploadFile: vi.fn(),
    mockReadFile: vi.fn(),
}));

// Mock CdnService
vi.mock("../../services/cdn", () => ({
    CdnService: vi.fn().mockImplementation(function () {
        this.getFileMetadata = mockGetFileMetadata;
        this.uploadFile = mockUploadFile;
    }),
}));

// Mock fs-extra readFile for uploadAsset
vi.mock("fs-extra", () => ({
    default: {
        readFile: mockReadFile,
    },
    readFile: mockReadFile,
}));

import { CdnAssetTarget } from "./main";
import type { AssetEntry, ProcessedAsset } from "../../sdk/models/asset-tap/types";

function makeEntry(overrides: Partial<AssetEntry> = {}): AssetEntry {
    return {
        sourcePath: "/remote/logo.jpg",
        destinationPath: "logos/logo.jpg",
        lastModified: new Date("2024-06-01T00:00:00Z"),
        contentType: "image/jpeg",
        ...overrides,
    };
}

function makeAsset(entry: AssetEntry): ProcessedAsset {
    return {
        entry,
        downloadedPath: "out/tmp/logo.jpg",
        uploadPath: "out/tmp/logo.jpg",
        wasTransformed: false,
        size: 1024,
        contentType: "image/jpeg",
    };
}

describe("CdnAssetTarget.shouldSync", () => {
    let target: CdnAssetTarget;

    beforeEach(() => {
        vi.clearAllMocks();
        target = new CdnAssetTarget({ apiEndpoint: "https://api.whaly.io", serviceAccountKey: "sk:x", cdnId: "cdn-1" });
    });

    it("returns true when file does not exist in CDN", async () => {
        mockGetFileMetadata.mockResolvedValue({ exists: false, lastModified: null, contentType: null });
        const entry = makeEntry();
        expect(await target.shouldSync(entry)).toBe(true);
    });

    it("returns true when source is newer than CDN file", async () => {
        mockGetFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: new Date("2024-01-01T00:00:00Z"),
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: new Date("2024-06-01T00:00:00Z") });
        expect(await target.shouldSync(entry)).toBe(true);
    });

    it("returns false when CDN file is same age or newer", async () => {
        const date = new Date("2024-06-01T00:00:00Z");
        mockGetFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: date,
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: date });
        expect(await target.shouldSync(entry)).toBe(false);
    });

    it("returns true when source lastModified is undefined (cannot compare)", async () => {
        mockGetFileMetadata.mockResolvedValue({
            exists: true,
            lastModified: new Date(),
            contentType: "image/jpeg",
        });
        const entry = makeEntry({ lastModified: undefined });
        expect(await target.shouldSync(entry)).toBe(true);
    });
});

describe("CdnAssetTarget.uploadAsset", () => {
    let target: CdnAssetTarget;

    beforeEach(() => {
        vi.clearAllMocks();
        target = new CdnAssetTarget({ apiEndpoint: "https://api.whaly.io", serviceAccountKey: "sk:x", cdnId: "cdn-1" });
    });

    it("reads file from uploadPath and calls cdnService.uploadFile", async () => {
        const fileBuffer = Buffer.from("image-data");
        mockReadFile.mockResolvedValue(fileBuffer);
        mockUploadFile.mockResolvedValue({ filePath: "/org/cdn-1/file/logos/logo.jpg" });

        const entry = makeEntry();
        const asset = makeAsset(entry);
        await target.uploadAsset(asset);

        expect(mockReadFile).toHaveBeenCalledWith(asset.uploadPath);
        expect(mockUploadFile).toHaveBeenCalledWith(
            "cdn-1",
            entry.destinationPath,
            fileBuffer
        );
    });
});
