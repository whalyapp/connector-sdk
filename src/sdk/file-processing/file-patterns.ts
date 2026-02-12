/**
 * Variable extraction utilities for common filename patterns.
 */
export class VariableExtractors {
    /**
     * Returns the filename as a variable.
     */
    static filename(): (filename: string) => { [key: string]: string | undefined } {
        return (filename: string) => ({
            fileName: filename,
        });
    }

    /**
     * Extracts named capture groups from a regex pattern.
     */
    static regex(pattern: RegExp): (filename: string) => { [key: string]: string | undefined } {
        return (filename: string) => {
            const match = filename.match(pattern);
            return match?.groups ?? {};
        };
    }

    /**
     * Combines multiple extraction functions.
     */
    static combine(
        ...extractors: ((filename: string) => { [key: string]: string | undefined })[]
    ): (filename: string) => { [key: string]: string | undefined } {
        return (filename: string) => {
            return extractors.reduce((acc, extractor) => {
                return { ...acc, ...extractor(filename) };
            }, {});
        };
    }
}

/**
 * File pattern utilities for common filename validation patterns.
 */
export class FilePatterns {
    /**
     * Creates a validator for files starting with a specific prefix (case-insensitive).
     */
    static startsWith(prefix: string): (filename: string) => boolean {
        return (filename: string) => filename.toLowerCase().startsWith(prefix.toLowerCase());
    }

    /**
     * Creates a validator for files matching a regex pattern.
     */
    static regex(pattern: RegExp): (filename: string) => boolean {
        return (filename: string) => pattern.test(filename);
    }

    /**
     * Combines multiple validators with AND logic.
     */
    static and(...validators: ((filename: string) => boolean)[]): (filename: string) => boolean {
        return (filename: string) => validators.every(validator => validator(filename));
    }

    /**
     * Combines multiple validators with OR logic.
     */
    static or(...validators: ((filename: string) => boolean)[]): (filename: string) => boolean {
        return (filename: string) => validators.some(validator => validator(filename));
    }
}
