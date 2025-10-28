import isPlainObject from "lodash/isPlainObject.js";

// Truncate potentially large query params for logging efficiency
const MAX_QS_KEYS = 10;
const MAX_QS_STRING_LENGTH = 200;
const MAX_QS_ARRAY_ITEMS = 5;
const MAX_QS_DEPTH = 2;

function truncateQueryParams(value: any, depth: number = 0): any {
    if (value == null) return value;
    if (depth >= MAX_QS_DEPTH) return "[…]";

    if (typeof value === "string") {
        if (value.length <= MAX_QS_STRING_LENGTH) return value;
        const truncated = value.slice(0, MAX_QS_STRING_LENGTH);
        return `${truncated}…(+${value.length - MAX_QS_STRING_LENGTH} chars)`;
    }

    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_QS_ARRAY_ITEMS)
            .map((v) => truncateQueryParams(v, depth + 1));
        const omittedCount = Math.max(0, value.length - MAX_QS_ARRAY_ITEMS);
        if (omittedCount > 0) {
            items.push(`[… ${omittedCount} more items]`);
        }
        return items;
    }

    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        const result: Record<string, any> = {};
        for (const key of keys.slice(0, MAX_QS_KEYS)) {
            result[key] = truncateQueryParams((value as any)[key], depth + 1);
        }
        const omittedCount = Math.max(0, keys.length - MAX_QS_KEYS);
        if (omittedCount > 0) {
            (result as any)["__omittedKeys"] = omittedCount;
        }
        return result;
    }

    return value;
}

export function getTruncatedParamsForLog(params: any): any {
    try {
        return truncateQueryParams(params);
    } catch {
        return "[unserializable params]";
    }
}