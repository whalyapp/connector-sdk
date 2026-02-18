import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
    execFile: vi.fn(),
}));

import * as cp from "node:child_process";
import { ImageMagickTransform } from "./image-magick-transform";

describe("ImageMagickTransform.toWebp", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("calls magick mogrify with correct arguments and returns webp path", async () => {
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(null, "", "");
            return {} as any;
        });

        const inputPath = "out/tmp/logo.jpg";
        const result = await ImageMagickTransform.toWebp(inputPath, {
            width: 250,
            height: 250,
            background: "none",
            gravity: "center",
            extent: true,
        });

        expect(result).toBe(path.join("out/tmp", "logo.webp"));

        expect(cp.execFile).toHaveBeenCalledOnce();
        const [cmd, args] = vi.mocked(cp.execFile).mock.calls[0]!;
        expect(cmd).toBe("magick");
        expect(args).toContain("mogrify");
        expect(args).toContain("-format");
        expect(args).toContain("webp");
        expect(args).toContain("-resize");
        expect(args).toContain("250x250");
        expect(args).toContain("-background");
        expect(args).toContain("none");
        expect(args).toContain("-gravity");
        expect(args).toContain("center");
        expect(args).toContain("-extent");
        expect(args).toContain(inputPath);
    });

    it("works without optional parameters", async () => {
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(null, "", "");
            return {} as any;
        });

        const result = await ImageMagickTransform.toWebp("out/tmp/img.png", {});
        expect(result).toBe(path.join("out/tmp", "img.webp"));

        const [, args] = vi.mocked(cp.execFile).mock.calls[0]!;
        expect(args).not.toContain("-resize");
        expect(args).not.toContain("-background");
        expect(args).not.toContain("-gravity");
        expect(args).not.toContain("-extent");
    });

    it("rejects when magick exits with an error", async () => {
        vi.mocked(cp.execFile).mockImplementation((_cmd, _args, callback: any) => {
            callback(new Error("magick not found"), "", "");
            return {} as any;
        });

        await expect(
            ImageMagickTransform.toWebp("out/tmp/logo.jpg", {})
        ).rejects.toThrow("magick not found");
    });
});
