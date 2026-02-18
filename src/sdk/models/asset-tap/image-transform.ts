import sharp from "sharp";
import path from "node:path";

export interface WebpTransformOptions {
    /** Target width in pixels */
    width?: number;
    /** Target height in pixels */
    height?: number;
    /**
     * Background color for padding when using `extent`.
     * - "none" or "transparent" → fully transparent
     * - "white", "black", etc. → named CSS color
     * - "#rrggbb" or "#rrggbbaa" → hex color
     */
    background?: string;
    /**
     * How to position the image within the extent canvas.
     * Maps to sharp's `position` option on `resize`.
     * Common values: "center" (default), "top", "bottom", "left", "right",
     * "top left", "top right", "bottom left", "bottom right".
     */
    gravity?: string;
    /**
     * If true and width/height are set, the output will be padded to
     * exactly width×height (like ImageMagick's `-extent`).
     * The image is resized to fit inside the dimensions first,
     * then padded with the background color to fill the canvas.
     */
    extent?: boolean;
    /** WebP quality (1-100). Defaults to sharp's default (80). */
    quality?: number;
}

const SHARP_GRAVITY: Record<string, string> = {
    center: "centre",
    top: "north",
    bottom: "south",
    left: "west",
    right: "east",
    "top left": "northwest",
    "top right": "northeast",
    "bottom left": "southwest",
    "bottom right": "southeast",
};

function parseBackground(bg: string | undefined): sharp.Color {
    if (bg === undefined || bg === "none" || bg === "transparent") {
        return { r: 0, g: 0, b: 0, alpha: 0 };
    }
    // Let sharp parse CSS color strings (hex, named colors, etc.)
    return bg as unknown as sharp.Color;
}

export class ImageTransform {
    /**
     * Converts an image to WebP format using sharp (libvips).
     *
     * The output file is written to the same directory as the input,
     * with the extension replaced by `.webp`.
     *
     * @param inputPath  Path to the source image file.
     * @param options    Optional resize / padding parameters.
     * @returns          Path to the produced `.webp` file.
     */
    static async toWebp(inputPath: string, options: WebpTransformOptions): Promise<string> {
        const dir = path.dirname(inputPath);
        const basename = path.basename(inputPath, path.extname(inputPath));
        const outputPath = path.join(dir, `${basename}.webp`);

        let pipeline = sharp(inputPath);

        const hasSize = options.width !== undefined && options.height !== undefined;

        if (hasSize) {
            const position = options.gravity !== undefined
                ? (SHARP_GRAVITY[options.gravity] ?? options.gravity)
                : undefined;

            if (options.extent === true) {
                // Resize to fit within dimensions, then pad to exact size
                pipeline = pipeline.resize(options.width, options.height, {
                    fit: "contain",
                    position,
                    background: parseBackground(options.background),
                });
            } else {
                // Resize to fit within dimensions (no padding)
                pipeline = pipeline.resize(options.width, options.height, {
                    fit: "inside",
                    position,
                });
            }
        }

        pipeline = pipeline.webp(
            options.quality !== undefined ? { quality: options.quality } : {}
        );

        await pipeline.toFile(outputPath);

        return outputPath;
    }
}
