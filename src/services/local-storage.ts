import { File } from "@google-cloud/storage";
import * as pathModule from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import { logger } from "../sdk/service/logger";
import { StorageService } from "./storage";

const logPrefix = "[LocalStorageService]";

export interface LocalStorageServiceOptions {
    processedSuffix?: string;
    supportedExtensions?: string[];
}

/**
 * Local filesystem implementation of StorageService.
 * Operates entirely on the local filesystem — no cloud interaction.
 */
export class LocalStorageService implements StorageService {
    private basePath: string;
    private processedSuffix: string;
    private supportedExtensions: string[];

    constructor(
        basePath: string,
        opts?: LocalStorageServiceOptions,
    ) {
        this.basePath = pathModule.resolve(basePath);
        this.processedSuffix = opts?.processedSuffix ?? ".processed";
        this.supportedExtensions = opts?.supportedExtensions ?? [];
    }

    async listFiles(prefix?: string): Promise<string[]> {
        const dir = prefix ? pathModule.resolve(this.basePath, prefix) : this.basePath;
        if (!fs.existsSync(dir)) {
            return [];
        }
        const entries = fs.readdirSync(dir, { recursive: true });
        const files: string[] = [];
        for (const entry of entries) {
            const rel = typeof entry === "string" ? entry : entry.toString();
            const full = pathModule.join(dir, rel);
            if (fs.statSync(full).isFile()) {
                // Return paths relative to basePath, matching GCS key style
                files.push(pathModule.relative(this.basePath, full));
            }
        }
        return files;
    }

    async getUnprocessedFiles(): Promise<string[]> {
        const allFiles = await this.listFiles();

        const markerFiles = new Set(
            allFiles
                .filter(f => f.endsWith(this.processedSuffix))
                .map(f => f.replace(this.processedSuffix, "")),
        );

        return allFiles.filter(f => {
            if (f.endsWith(this.processedSuffix)) return false;

            if (this.supportedExtensions.length > 0) {
                const ext = pathModule.extname(f).toLowerCase();
                if (!this.supportedExtensions.includes(ext)) return false;
            }

            return !markerFiles.has(f);
        });
    }

    async createMarkerFile(fileName: string): Promise<void> {
        const markerPath = pathModule.join(this.basePath, `${fileName}${this.processedSuffix}`);
        const dir = pathModule.dirname(markerPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(markerPath, `Marked file ${fileName} as processed`);
        logger.info(`${logPrefix} Marker file ${markerPath} created successfully.`);
    }

    async downloadFile(filePath: string, _fileName: string): Promise<string> {
        const resolved = pathModule.resolve(this.basePath, filePath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Local file not found: ${resolved}`);
        }
        logger.info(`${logPrefix} Resolved local file: ${resolved}`);
        return resolved;
    }

    async resolveFileUri(fileUri: string): Promise<string> {
        const resolved = pathModule.resolve(fileUri);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Local file not found: ${resolved}`);
        }
        logger.info(`${logPrefix} File URI resolved to local path: ${resolved}`);
        return resolved;
    }

    async uploadFile(localPath: string, destPath: string): Promise<File> {
        const dest = pathModule.resolve(this.basePath, destPath);
        const dir = pathModule.dirname(dest);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.copyFileSync(localPath, dest);
        logger.info(`${logPrefix} Copied '%s' to '%s'`, localPath, dest);
        return { name: destPath } as unknown as File;
    }

    async readObjectAsString(objectPath: string): Promise<string> {
        const fullPath = pathModule.resolve(this.basePath, objectPath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Local file not found: ${fullPath}`);
        }
        return fs.readFileSync(fullPath, "utf8");
    }

    async writeStringObject(objectPath: string, contents: string): Promise<void> {
        const fullPath = pathModule.resolve(this.basePath, objectPath);
        const dir = pathModule.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, contents, "utf8");
        logger.info(`${logPrefix} Wrote object to ${fullPath}`);
    }

    async uploadFileWithUniqueName(filePath: string, prefix: string, streamId: string): Promise<File> {
        const runFolder = process.env.RUN_ID ?? "default";
        const destName = `${prefix}/${runFolder}/${streamId}-${randomUUID()}.jsonnl`;
        return this.uploadFile(filePath, destName);
    }
}
