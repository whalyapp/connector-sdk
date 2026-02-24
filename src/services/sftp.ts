import path from "node:path";
import fs from "fs-extra";
import Client from "ssh2-sftp-client";
import type sftp from "ssh2-sftp-client";
import { logger } from "../sdk/service/logger";
import { runWithConcurrency } from "../sdk/service/concurrency";

export { default as SftpClient } from "ssh2-sftp-client";
export type { ConnectOptions as SftpConnectOptions, FileInfo as SftpFileInfo } from "ssh2-sftp-client";

/**
 * Pre-instantiated SFTP client singleton.
 * @deprecated Prefer creating your own SftpClient instance for better lifecycle control.
 */
export const SftpService = new Client();

const logPrefix = "[sftp]";

export interface ListFilesOptions {
    /** Recurse into subdirectories. Defaults to true. */
    recursive?: boolean;
    /** Only include files whose extension (lowercased, with dot) is in this set. */
    extensions?: string[];
    /** Safety limit on the number of directories traversed. Defaults to 1000. */
    maxIterations?: number;
}

/**
 * List files on an SFTP server, optionally recursing into subdirectories.
 */
export async function listFilesRecursively(
    client: Client,
    remotePath: string,
    options?: ListFilesOptions,
): Promise<sftp.FileInfo[]> {
    const recursive = options?.recursive ?? true;
    const extensions = options?.extensions?.map(e => e.toLowerCase());
    const maxIterations = options?.maxIterations ?? 1_000;

    const results: sftp.FileInfo[] = [];
    const dirs: string[] = [remotePath];
    let iterations = 0;

    while (dirs.length > 0) {
        if (iterations++ >= maxIterations) {
            logger.warn(`${logPrefix} listFilesRecursively reached maxIterations (${maxIterations}), stopping.`);
            break;
        }

        const currentDir = dirs.shift()!;
        let entries: sftp.FileInfo[];
        try {
            entries = await client.list(currentDir);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`${logPrefix} Failed to list ${currentDir}: ${msg}`);
            continue;
        }

        for (const entry of entries) {
            if (entry.type === "d") {
                if (recursive && entry.name !== "." && entry.name !== "..") {
                    dirs.push(path.posix.join(currentDir, entry.name));
                }
                continue;
            }

            if (entry.type !== "-") continue; // skip symlinks etc.

            if (extensions) {
                const ext = path.extname(entry.name).toLowerCase();
                if (!extensions.includes(ext)) continue;
            }

            // Attach the full remote path to the name for convenience
            const fullPath = path.posix.join(currentDir, entry.name);
            results.push({ ...entry, name: fullPath });
        }
    }

    logger.info(`${logPrefix} listFilesRecursively found ${results.length} files under ${remotePath}`);
    return results;
}

export interface DownloadFilesOptions {
    /** Max concurrent downloads. Defaults to 5. */
    concurrency?: number;
}

/**
 * Download a list of remote files to a local directory.
 * Returns the array of local file paths written.
 */
export async function downloadFiles(
    client: Client,
    files: sftp.FileInfo[],
    localDir: string,
    options?: DownloadFilesOptions,
): Promise<string[]> {
    const concurrency = options?.concurrency ?? 5;
    await fs.ensureDir(localDir);

    const tasks = files.map((file, index) => () => {
        // Prefix with index to avoid basename collisions
        const localName = `${index}_${path.basename(file.name)}`;
        const localPath = path.join(localDir, localName);
        logger.debug(`${logPrefix} Downloading ${file.name} → ${localPath}`);
        return client.fastGet(file.name, localPath).then(() => localPath);
    });

    const results = await runWithConcurrency(tasks, concurrency);
    logger.info(`${logPrefix} Downloaded ${results.length} files to ${localDir}`);
    return results;
}
