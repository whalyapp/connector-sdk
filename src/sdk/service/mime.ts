import path from "node:path";

/**
 * Known MIME types indexed by lowercase extension (with leading dot).
 */
export const MIME_TYPES: Record<string, string> = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Look up the MIME type for a file path or extension.
 * Returns `application/octet-stream` when the extension is unknown.
 */
export function getMimeType(filePathOrExt: string): string {
    const ext = filePathOrExt.startsWith(".")
        ? filePathOrExt.toLowerCase()
        : path.extname(filePathOrExt).toLowerCase();
    return MIME_TYPES[ext] ?? "application/octet-stream";
}
