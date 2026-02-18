import { execFile } from "node:child_process";
import path from "node:path";

export interface WebpOptions {
    width?: number;
    height?: number;
    background?: string;
    gravity?: string;
    extent?: boolean;
}

export class ImageMagickTransform {
    static toWebp(inputPath: string, options: WebpOptions): Promise<string> {
        const dir = path.dirname(inputPath);
        const basename = path.basename(inputPath, path.extname(inputPath));
        const outputPath = path.join(dir, `${basename}.webp`);

        const args: string[] = ["mogrify", "-format", "webp"];

        if (options.width !== undefined && options.height !== undefined) {
            args.push("-resize", `${options.width}x${options.height}`);
        }
        if (options.background !== undefined) {
            args.push("-background", options.background);
        }
        if (options.gravity !== undefined) {
            args.push("-gravity", options.gravity);
        }
        if (options.extent === true && options.width !== undefined && options.height !== undefined) {
            args.push("-extent", `${options.width}x${options.height}`);
        }

        args.push(inputPath);

        return new Promise((resolve, reject) => {
            execFile("magick", args, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(outputPath);
                }
            });
        });
    }
}
