import { WriteStream } from "fs"
import { StreamId } from "../metadata";

export interface FlattenedSchema {
    [unsafePropertyName: string]: JSONSchemaFieldDefinition
}

export interface JSONSchemaFieldDefinition {
    type: string[] | string
    format?: "date-time" | "json";
    items?: JSONSchemaFieldDefinition;
}

export interface WarehouseTableField {
    name: string; // This name is already safe as it's coming from the Warehouse
    type: string;
}

export interface InternalTableField {
    unsafeName: string;
    name: string, // This name should be already safe for the Warehouse
    definition: JSONSchemaFieldDefinition
}

export interface TempFile {
    stream: WriteStream,
    path: string;
}

export interface StreamWithTempFile {
    streamId: StreamId,
    tempFile: TempFile
}

export const DEFAULT_SYNCED_AT_COLUMN = "_wly_synced_at";

export interface BaseConfig {
    connector_id: string;
    database: string;
    schema: string;
    syncedAtColumnName?: string;
    syncedAtColumnUseLegacyStringType?: boolean;
}