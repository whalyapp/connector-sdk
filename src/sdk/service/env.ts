import dotenv from "dotenv";

let dotenvLoaded = false;

function ensureDotenv(): void {
    if (!dotenvLoaded) {
        dotenv.config();
        dotenvLoaded = true;
    }
}

/**
 * Read a required environment variable. Throws if not set or empty.
 * Automatically loads .env file on first call.
 */
export function requireEnv(name: string): string {
    ensureDotenv();
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

/**
 * Read an optional environment variable, returning a default if not set.
 * Automatically loads .env file on first call.
 */
export function optionalEnv(name: string, defaultValue: string): string {
    ensureDotenv();
    return process.env[name] ?? defaultValue;
}
