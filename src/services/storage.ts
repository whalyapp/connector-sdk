import { File } from "@google-cloud/storage";

/**
 * Common interface for storage services (cloud or local).
 * Implemented by CloudStorageService and LocalStorageService.
 */
export interface StorageService {
    /**
     * Lists all files with an optional prefix/path filter.
     */
    listFiles(prefix?: string): Promise<string[]>;

    /**
     * Returns files that haven't been marked as processed.
     */
    getUnprocessedFiles(): Promise<string[]>;

    /**
     * Creates a marker file to indicate a file has been processed.
     */
    createMarkerFile(fileName: string): Promise<void>;

    /**
     * Downloads/resolves a file and returns a local file path.
     */
    downloadFile(filePath: string, fileName: string): Promise<string>;

    /**
     * Resolves a file URI to a local file path.
     * Cloud: downloads from bucket. Local: resolves and validates the local path.
     */
    resolveFileUri(fileUri: string): Promise<string>;

    /**
     * Uploads a local file to the storage destination.
     */
    uploadFile(localPath: string, destPath: string): Promise<File>;

    /**
     * Reads a storage object and returns its contents as a UTF-8 string.
     */
    readObjectAsString(objectPath: string): Promise<string>;

    /**
     * Writes a string to a storage object with JSON content type.
     */
    writeStringObject(objectPath: string, contents: string): Promise<void>;

    /**
     * Uploads a local file with a unique generated name.
     */
    uploadFileWithUniqueName(filePath: string, prefix: string, streamId: string): Promise<File>;
}
