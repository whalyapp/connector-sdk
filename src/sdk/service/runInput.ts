/**
 * What a Whaly FileUpload run hands its transformer: the files to process and, for runs started
 * by an inbound email, who sent it and when.
 */

export interface EmailMetadata {
    from?: string | null;
    subject?: string | null;
    receivedAt?: string | null;
}

export type RunTrigger = "MANUAL" | "EMAIL" | "REPLAY";

/**
 * The run's input files, as object keys in the job's storage (pass each to
 * `storage.resolveFileUri`). Email runs list every kept attachment in `WLY_FILE_URIS`; manual
 * uploads only set `FILE_URI`, so this works for both.
 */
export function getInputFiles(env: NodeJS.ProcessEnv = process.env): string[] {
    const list = env.WLY_FILE_URIS;
    if (list) {
        const parsed: unknown = JSON.parse(list);
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
            throw new Error("WLY_FILE_URIS must be a JSON array of strings");
        }
        if (parsed.length > 0) {
            return parsed;
        }
    }
    return env.FILE_URI ? [env.FILE_URI] : [];
}

/** Sender, subject and receive time of the email that started the run; undefined otherwise. */
export function getEmailMetadata(env: NodeJS.ProcessEnv = process.env): EmailMetadata | undefined {
    const raw = env.WLY_EMAIL_METADATA;
    if (!raw) {
        return undefined;
    }
    return JSON.parse(raw) as EmailMetadata;
}

export function getRunTrigger(env: NodeJS.ProcessEnv = process.env): RunTrigger {
    const trigger = env.WLY_RUN_TRIGGER;
    return trigger === "EMAIL" || trigger === "REPLAY" ? trigger : "MANUAL";
}
