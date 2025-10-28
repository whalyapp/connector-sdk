import { ValidationError } from "jsonschema";
import { StreamId } from "../catalog";

export class SchemaValidationError extends Error {

    streamId: StreamId;
    validationErrors: ValidationError[];

    constructor(message: string, streamId: StreamId, errors: ValidationError[]) {
        super(message); // (1)
        this.name = "SchemaValidationError"; // (2)
        this.streamId = streamId;
        this.validationErrors = errors;
    }

}

export class MissingFieldInSchemaError extends Error {

    streamId: StreamId;

    constructor(message: string, streamId: StreamId) {
        super(message); // (1)
        this.name = "MissingFieldInSchemaError"; // (2)
        this.streamId = streamId;
    }

}

export class MissingSchemaError extends Error {

    streamId: StreamId;

    constructor(message: string, streamId: StreamId) {
        super(message); // (1)
        this.name = "MissingSchemaError"; // (2)
        this.streamId = streamId;
    }

}