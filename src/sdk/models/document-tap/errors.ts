export class DocumentDownloadSkipError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DocumentDownloadSkipError";
    }
}
