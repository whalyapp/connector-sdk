export function isDryRun(): boolean {
    const val = process.env["DRY_RUN"];
    return val !== undefined && val !== "" && val !== "0" && val !== "false";
}

export function getDryRunLimit(): number | undefined {
    const val = process.env["DRY_RUN_LIMIT"];
    if (!val) return undefined;
    const n = parseInt(val, 10);
    return isNaN(n) || n <= 0 ? undefined : n;
}
