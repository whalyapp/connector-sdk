import { Storage, File } from "@google-cloud/storage";
import { format } from "util";
import * as pathModule from "path";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { logger } from "../sdk/service/logger";

const logPrefix = "[CloudStorageService]";
const tmpDir = "tmp";

export interface CloudStorageServiceOptions {
    processedSuffix?: string;
    supportedExtensions?: string[];
}

/**
 * Service for interacting with Google Cloud Storage.
 * Supports file download, upload, listing, and marker-file-based processing tracking.
 */
export class CloudStorageService {
    private storage: Storage;
    private bucket: ReturnType<Storage["bucket"]>;
    private processedSuffix: string;
    private supportedExtensions: string[];
    private path: string | undefined;

    constructor(
        bucketName: string,
        path?: string,
        opts?: CloudStorageServiceOptions,
    ) {
        this.storage = new Storage({ retryOptions: { autoRetry: true, maxRetries: 20 } });
        this.bucket = this.storage.bucket(bucketName);
        this.path = path;
        this.processedSuffix = opts?.processedSuffix ?? ".processed";
        this.supportedExtensions = opts?.supportedExtensions ?? [];
    }

    /**
     * Lists all files in the bucket with an optional prefix.
     */
    async listFiles(prefix?: string): Promise<string[]> {
        const effectivePrefix = prefix || this.path;
        const [files] = await this.bucket.getFiles(
            effectivePrefix ? { prefix: effectivePrefix } : undefined,
        );
        return files.map(f => f.name);
    }

    /**
     * Returns files that haven't been marked as processed.
     * Filters by supported extensions if configured.
     */
    async getUnprocessedFiles(): Promise<string[]> {
        const allFiles = await this.listFiles();

        const markerFiles = new Set(
            allFiles
                .filter(f => f.endsWith(this.processedSuffix))
                .map(f => f.replace(this.processedSuffix, "")),
        );

        return allFiles.filter(f => {
            if (f.endsWith(this.processedSuffix)) return false;
            if (f.endsWith("/")) return false;

            if (this.supportedExtensions.length > 0) {
                const ext = pathModule.extname(f).toLowerCase();
                if (!this.supportedExtensions.includes(ext)) return false;
            }

            return !markerFiles.has(f);
        });
    }

    /**
     * Creates a marker file to indicate a file has been processed.
     */
    async createMarkerFile(fileName: string): Promise<void> {
        const markerFileName = `${fileName}${this.processedSuffix}`;
        try {
            const file = this.bucket.file(markerFileName);
            await file.save(format("Marked file %s as processed", fileName));
            logger.info(`${logPrefix} Marker file ${markerFileName} created successfully.`);
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(format(`error while writing marker file=%s, err:%s`, markerFileName, err.message));
            }
            throw err;
        }
    }

    /**
     * Downloads a file from GCS to a local tmp directory.
     * Returns the local path of the downloaded file.
     */
    async downloadFile(filePath: string, fileName: string): Promise<string> {
        const file = this.bucket.file(filePath);
        const tmpDirPath = pathModule.join(process.cwd(), tmpDir);
        if (!existsSync(tmpDirPath)) {
            mkdirSync(tmpDirPath);
        }
        const destFilename = pathModule.join(process.cwd(), tmpDir, fileName);
        try {
            if (existsSync(destFilename)) {
                unlinkSync(destFilename);
            }
            await file.download({ destination: destFilename });
            logger.info(`${logPrefix} Downloaded ${fileName} to ${destFilename}`);
            return destFilename;
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(format(
                    `can't download file=%s from bucket, err:%s`,
                    fileName,
                    err.message,
                ));
            }
            throw err;
        }
    }

    /**
     * Uploads a local file to GCS.
     */
    async uploadFile(localPath: string, destPath: string): Promise<File> {
        try {
            logger.info(`${logPrefix} preparing to upload '%s' to '%s'`, localPath, destPath);
            const [file] = await this.bucket.upload(localPath, { destination: destPath });
            logger.info(`${logPrefix} file %s has been successfully uploaded into %s`, localPath, destPath);
            return file;
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(format(`error while uploading file file=%s into path=%s, err:%s`, localPath, destPath, err.message));
            }
            throw err;
        }
    }

    /**
     * Reads a GCS object and returns its contents as a UTF-8 string.
     */
    async readObjectAsString(objectPath: string): Promise<string> {
        try {
            await this.bucket.get({ autoCreate: false });
            const fileRef = this.bucket.file(objectPath);
            const [exists] = await fileRef.exists();
            if (!exists) {
                throw new Error(`GCS object not found: gs://${this.bucket.name}/${objectPath}`);
            }
            const [contents] = await fileRef.download();
            return contents.toString('utf8');
        } catch (err: any) {
            throw new Error(format(`error reading GCS object gs://${this.bucket.name}/${objectPath}, err: %s`, err?.message));
        }
    }

    /**
     * Writes a string to a GCS object with JSON content type.
     */
    async writeStringObject(objectPath: string, contents: string): Promise<void> {
        try {
            await this.bucket.get({ autoCreate: false });
            const fileRef = this.bucket.file(objectPath);
            await fileRef.save(contents, { contentType: 'application/json' });
            logger.info(`Uploaded object to gs://${this.bucket.name}/${objectPath}`);
        } catch (err: any) {
            throw new Error(format(`error writing GCS object gs://${this.bucket.name}/${objectPath}, err: %s`, err?.message));
        }
    }

    /**
     * Uploads a local file to the bucket with a unique name based on prefix, streamId, and UUID.
     * Files are stored under `<prefix>/<run-id>/` when the RUN_ID env var is set,
     * or `<prefix>/default/` otherwise.
     * Returns the GCS File reference.
     */
    async uploadFileWithUniqueName(filePath: string, prefix: string, streamId: string): Promise<File> {
        try {
            await this.bucket.get({ autoCreate: false });

            const runFolder = process.env.RUN_ID ?? "default";
            const destinationFileName = `${prefix}/${runFolder}/${streamId}-${randomUUID()}.jsonnl`;

            await this.bucket.upload(filePath, {
                destination: destinationFileName
            });

            logger.info(`Uploaded ${filePath} into ${this.bucket.name}/${destinationFileName} GCS File`);

            return this.bucket.file(destinationFileName);
        } catch (err: any) {
            logger.error(`Issue when uploading file into GCS bucket for stream: ${streamId}

        Error: ${err.message}
        Stack: ${err.stack}
        Code: ${err.code}
        `);

            throw err;
        }
    }
}
