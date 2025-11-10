import { StreamId } from "./metadata";
import { ReplicationMethod } from "./replication";
import { PropertiesMetadata } from "./schema";

export type MessageType = "RECORD" | "STATE" | "SCHEMA" | "ACTIVATE_VERSION" | "REPLICATION_METHOD";

export interface Message {
    type: MessageType;
    toString(): string;
}

export class RecordMessage implements Message {

    type: MessageType = "RECORD"
    stream: StreamId;
    record: any;

    constructor(record: any, stream: StreamId) {
        this.record = record;
        this.stream = stream;
    }

    toString() {
        const result = {
            type: "RECORD",
            record: this.record,
            stream: this.stream
        }
        return JSON.stringify(result);
    }
}

export class StateMessage implements Message {

    type: MessageType = "STATE"
    value: any

    constructor(value: any) {
        this.value = value
    }

    toString() {
        const result = {
            type: "STATE",
            value: this.value
        }
        return JSON.stringify(result);
    }
}

export class ReplicationMethodMessage implements Message {

    type: MessageType = "REPLICATION_METHOD";
    stream: string;
    replication: ReplicationMethod;

    constructor(stream: string, version: ReplicationMethod) {
        this.stream = stream;
        this.replication = version;
    }

    toString() {
        const result = {
            type: "REPLICATION_METHOD",
            replication: this.replication,
            stream: this.stream
        }
        return JSON.stringify(result);
    }
}

export class SchemaMessage implements Message {

    type: MessageType = "SCHEMA";
    stream: StreamId;
    schema: any;
    keyProperties: string[];
    bookmarkProperties: string[] | undefined;
    displayLabel: string | undefined;
    description: string | undefined;
    propertiesMetadata: PropertiesMetadata | undefined

    constructor(opts: {
        stream: StreamId,
        schema: any,
        keyProperties: string[],
        bookmarkProperties?: string[],
        displayLabel?: string,
        description?: string,
        propertiesMetadata?: PropertiesMetadata | undefined
    }) {
        const {
            stream,
            schema,
            keyProperties,
            bookmarkProperties,
            displayLabel,
            description,
            propertiesMetadata
        } = opts;

        this.stream = stream;
        this.schema = schema;
        this.keyProperties = keyProperties;
        this.bookmarkProperties = bookmarkProperties;
        this.displayLabel = displayLabel;
        this.description = description;
        this.propertiesMetadata = propertiesMetadata;
    }

    toString() {
        const result: any = {
            type: "SCHEMA",
            stream: this.stream,
            schema: this.schema,
            key_properties: this.keyProperties,
            label: this.displayLabel,
            description: this.description,
        }

        if (this.bookmarkProperties) {
            result["bookmark_properties"] = this.bookmarkProperties
        }

        return JSON.stringify(result);
    }
}