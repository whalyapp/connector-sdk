import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { ImageTransform } from "./image-transform";

describe("ImageTransform.toWebp", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "img-transform-"));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    async function createTestImage(name: string, width: number, height: number): Promise<string> {
        const filePath = path.join(tmpDir, name);
        await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
            .png()
            .toFile(filePath);
        return filePath;
    }

    it("converts a PNG to WebP and returns the .webp path", async () => {
        const inputPath = await createTestImage("logo.png", 100, 100);

        const result = await ImageTransform.toWebp(inputPath, {});

        expect(result).toBe(path.join(tmpDir, "logo.webp"));
        expect(await fs.pathExists(result)).toBe(true);

        const metadata = await sharp(result).metadata();
        expect(metadata.format).toBe("webp");
    });

    it("resizes the image to fit within the given dimensions", async () => {
        const inputPath = await createTestImage("wide.png", 800, 400);

        const result = await ImageTransform.toWebp(inputPath, {
            width: 200,
            height: 200,
        });

        const metadata = await sharp(result).metadata();
        expect(metadata.format).toBe("webp");
        // 800x400 resized to fit inside 200x200 → 200x100
        expect(metadata.width).toBe(200);
        expect(metadata.height).toBe(100);
    });

    it("with extent=true, pads the image to exactly width×height", async () => {
        const inputPath = await createTestImage("wide.png", 800, 400);

        const result = await ImageTransform.toWebp(inputPath, {
            width: 250,
            height: 250,
            background: "none",
            gravity: "center",
            extent: true,
        });

        const metadata = await sharp(result).metadata();
        expect(metadata.format).toBe("webp");
        // Should be exactly 250x250 (padded with transparent background)
        expect(metadata.width).toBe(250);
        expect(metadata.height).toBe(250);
    });

    it("works without optional parameters (format conversion only)", async () => {
        const inputPath = await createTestImage("plain.png", 50, 50);

        const result = await ImageTransform.toWebp(inputPath, {});

        const metadata = await sharp(result).metadata();
        expect(metadata.format).toBe("webp");
        expect(metadata.width).toBe(50);
        expect(metadata.height).toBe(50);
    });

    it("rejects when the input file does not exist", async () => {
        await expect(
            ImageTransform.toWebp(path.join(tmpDir, "nonexistent.png"), {})
        ).rejects.toThrow();
    });

    it("accepts quality parameter", async () => {
        // Use a noisy image so quality differences are visible in file size
        const noisyPath = path.join(tmpDir, "noisy.png");
        const width = 200;
        const height = 200;
        const channels = 3;
        const pixels = Buffer.alloc(width * height * channels);
        for (let i = 0; i < pixels.length; i++) {
            pixels[i] = Math.floor(Math.random() * 256);
        }
        await sharp(pixels, { raw: { width, height, channels } }).png().toFile(noisyPath);

        const lowQ = await ImageTransform.toWebp(noisyPath, { quality: 1 });
        const lowSize = (await fs.stat(lowQ)).size;

        // Re-create input for high quality run
        const noisyPath2 = path.join(tmpDir, "noisy2.png");
        await fs.copy(noisyPath, noisyPath2);
        const highQ = await ImageTransform.toWebp(noisyPath2, { quality: 100 });
        const highSize = (await fs.stat(highQ)).size;

        // Higher quality should produce a larger file
        expect(highSize).toBeGreaterThan(lowSize);
    });
});
