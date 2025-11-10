import { StreamId } from "../metadata";
import { FlattenedSchema } from "./models";
import { logger } from "../../service/logger";
import { gracefulExit } from "../../service/exit";

export const flattenSchema = <T>(streamId: StreamId, schema: T): FlattenedSchema => {

    logger.debug(`Flattening schema for stream: ${streamId}`)

    try {
        const mSchema = schema as any;

        if (!mSchema["properties"]) {
            return {};
        }

        const properties = mSchema["properties"];

        const flattenedSchema = Object.keys(properties).reduce<FlattenedSchema>((acc, propertyName) => {
            const propertySchema = properties[propertyName];
            const columnName = propertyName;

            if (!propertySchema) {
                return acc;
            }

            if (!propertySchema["type"]) {
                throw new Error(`We don't have any \`type\` for the property: \`${propertyName}\`.
            Schema of the property is: ${JSON.stringify(propertySchema)}`)
            }

            acc[columnName] = {
                type: propertySchema["type"],
                format: propertySchema["format"],
                items: propertySchema["items"]
            };

            return acc;
        }, {});

        return flattenedSchema;
    } catch (err: any) {
        logger.error(`There was an error when processing the schema of stream:\`${streamId}\`: err: ${err.message} - ${err.stack}.
    Processed schema: ${JSON.stringify(schema)}`);
        gracefulExit(1);
        return {};
    }

}