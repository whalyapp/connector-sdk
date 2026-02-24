const ENV_VAR = "WLY_SERVICE_ACCOUNT_KEY";

export function getServiceAccountKey(explicit?: string): string {
    const key = explicit ?? process.env[ENV_VAR];
    if (!key) {
        throw new Error(
            `No service account key provided. Either pass "serviceAccountKey" in config or set the ${ENV_VAR} environment variable.`
        );
    }
    return key;
}
