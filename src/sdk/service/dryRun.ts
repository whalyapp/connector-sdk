export function isDryRun(): boolean {
    const val = process.env["DRY_RUN"];
    return val !== undefined && val !== "" && val !== "0" && val !== "false";
}
