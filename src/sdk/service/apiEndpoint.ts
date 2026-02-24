const ENV_VAR = "WLY_API_ENDPOINT";

export function getApiEndpoint(explicit?: string): string {
    const endpoint = explicit ?? process.env[ENV_VAR];
    if (!endpoint) {
        throw new Error(
            `No API endpoint provided. Either pass "apiEndpoint" in config or set the ${ENV_VAR} environment variable.`
        );
    }
    return endpoint;
}
