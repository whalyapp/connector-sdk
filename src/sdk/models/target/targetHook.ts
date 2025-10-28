import { SchemaMessage } from "../messages";

export interface TargetSchemaHookInput {
    message: SchemaMessage;
    // Name of the database mapped with the stream
    databaseName: string;
    // Name of the database schema mapped with the stream
    schemaName: string;
    // Name of the database table mapped with the stream
    tableName: string;
}

export interface TargetSchemaHook {
    writeSchema: (input: TargetSchemaHookInput) => Promise<void>
}