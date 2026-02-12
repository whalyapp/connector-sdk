import * as fse from "fs-extra";
import decompress from "decompress";

/**
 * Extract a ZIP (or other archive) file to a target directory.
 * Uses the `decompress` library which supports zip, tar, gz, bz2, etc.
 *
 * @param zipFilePath - Path to the archive file
 * @param extractedPath - Directory to extract into (created if it doesn't exist)
 * @returns The output directory path
 */
export const unzip = async (zipFilePath: string, extractedPath: string): Promise<string> => {
    await fse.ensureDir(extractedPath);
    await decompress(zipFilePath, extractedPath);
    return extractedPath;
};
