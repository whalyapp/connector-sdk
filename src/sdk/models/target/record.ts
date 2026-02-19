import { DEFAULT_SYNCED_AT_COLUMN, FlattenedSchema } from "./models";

export const removeParasiteProperties = (record: any, schema: FlattenedSchema) => {
    const schemaKeys = Object.keys(schema);
    Object.keys(record).forEach(key => {
        if (!schemaKeys.includes(key)) {
            delete record[key]
        }
    })

    return record;
}

export const addWhalyFields = (record: any, batchDate: string, columnName: string = DEFAULT_SYNCED_AT_COLUMN) => {
    return {
        ...record,
        [columnName]: batchDate
    }
}