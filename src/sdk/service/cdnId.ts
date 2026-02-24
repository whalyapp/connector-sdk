const ENV_VAR = "WLY_CDN_ID";

export function getCdnId(explicit?: string): string {
    const cdnId = explicit ?? process.env[ENV_VAR];
    if (!cdnId) {
        throw new Error(
            `No CDN ID provided. Either pass "cdnId" in config or set the ${ENV_VAR} environment variable.`
        );
    }
    return cdnId;
}
