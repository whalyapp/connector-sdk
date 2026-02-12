import {
    FieldType,
    ExcelFieldMapping,
    ExcelSourceColumn,
    ExcelDerivedField,
    CsvFieldsConfig,
    CsvFieldsArrayConfig,
    CsvFieldsDictConfig,
} from "./types";

type JsonSchemaProperty = {
    type: (string | "null")[];
    format?: string;
};

/**
 * Convert a FieldType to a JSON Schema property definition.
 */
export function fieldTypeToJsonSchema(fieldType: FieldType): JsonSchemaProperty {
    switch (fieldType) {
        case "STRING":
            return { type: ["null", "string"] };
        case "FLOAT":
            return { type: ["null", "number"] };
        case "TIMESTAMP":
            return { type: ["null", "string"], format: "date-time" };
        default:
            return { type: ["null", "string"] };
    }
}

/**
 * Convert an ExcelFieldMapping to a JSON Schema properties object.
 */
export function excelFieldsToJsonSchema(fields: ExcelFieldMapping): {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
} {
    const properties: Record<string, JsonSchemaProperty> = {};
    for (const [key, field] of Object.entries(fields)) {
        properties[key] = fieldTypeToJsonSchema(field.type);
    }
    return { type: "object", properties };
}

/**
 * Convert a CsvFieldsConfig to a JSON Schema properties object.
 */
export function csvFieldsToJsonSchema(config: CsvFieldsConfig): {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
} {
    const properties: Record<string, JsonSchemaProperty> = {};

    if (Array.isArray(config)) {
        for (const field of config as CsvFieldsArrayConfig) {
            properties[field.key] = fieldTypeToJsonSchema(field.type);
        }
    } else {
        for (const [, field] of Object.entries(config as CsvFieldsDictConfig)) {
            properties[field.key] = fieldTypeToJsonSchema(field.type);
        }
    }

    return { type: "object", properties };
}

/**
 * Extract all output keys from a CsvFieldsConfig to use as composite primary keys.
 * Useful for FULL_TABLE replication where all fields form the PK (since TRUNCATE + MERGE = INSERT).
 */
export function extractPrimaryKeysFromCsvConfig(config: CsvFieldsConfig): string[] {
    if (Array.isArray(config)) {
        return (config as CsvFieldsArrayConfig).map(f => f.key);
    }
    return Object.values(config as CsvFieldsDictConfig).map(f => f.key);
}

/**
 * Extract primary keys from an ExcelFieldMapping.
 */
export function extractPrimaryKeysFromExcelFields(fields: ExcelFieldMapping): string[] {
    return Object.entries(fields)
        .filter(([, field]) => {
            return (field as ExcelSourceColumn).primaryKey === true
                || (field as ExcelDerivedField).primaryKey === true;
        })
        .map(([key]) => key);
}
