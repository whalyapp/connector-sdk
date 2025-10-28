import { FlattenedSchema } from "./models";

export const removeParasiteProperties = (record: any, schema: FlattenedSchema) => {
    const schemaKeys = Object.keys(schema);
    Object.keys(record).forEach(key => {
        if (!schemaKeys.includes(key)) {
            delete record[key]
        }
    })

    return record;
}

export const addWhalyFields = (record: any, batchDate: string) => {
    return {
        ...record,
        _whaly_synced: batchDate
    }
}