import { logger } from "../../service/logger";
import { FlattenedSchema } from "./models";

// { "streamId": { "originalColumnName": "renamedColumnName" } }
export interface ColumnMappingStoreUnsafeToSafe {
    [originalColumnName: string]: string
}

export type SafeColumnNameConverterFn = (unsafe: string) => string

/**
 * This stateful class is to be used to store all the columns names mapping between the "raw" column name
 * found in the records and the destination column in the data warehouse
 * 
 * A mapping exists between the fields declared by the Tap and the reality in the Warehouse for those reasons:
 * - Columns that are versionned due to type changes since the last load
 * - Columns that have a name conflict after "Warehouse" sanitization
 */
export class RenameColumnStore {

    // Store all the mappings store for all streamId
    private renamedColumns: { [streamId: string]: ColumnMappingStoreUnsafeToSafe };

    private safeColumnNameConverter?: SafeColumnNameConverterFn;

    constructor() {
        this.renamedColumns = {};
    }

    setSafeColumnNameConverter = (fn: SafeColumnNameConverterFn): void => {
        this.safeColumnNameConverter = fn;
    }

    // This function has a side effect on:
    //  - `this.renamedColumns`
    // This isn't very clean and should be updated to write a pure version of this function
    computeColumnNameForStream = (
        streamId: string,
        flattenedSchema: FlattenedSchema,
    ) => {
        const safeColNameConv = this.safeColumnNameConverter;
        if (!safeColNameConv) {
            throw new Error(`safeColumnNameConverter is not defined!`)
        }
        const colSafeToUnsafeMapping = Object.keys(flattenedSchema)
            .sort()
            .reduce<{ [safeColName: string]: string }>((acc, unsafeColName) => {
                const safeColName = safeColNameConv(unsafeColName);
                if (!acc[safeColName]) {
                    acc[safeColName] = unsafeColName;
                } else {
                    logger.info(`🚨 Stream: ${streamId} - We have a column name conflict after sanitization for column unsafe=${unsafeColName}. We'll rename the sanitized name to a non taken name.
                Details: unsafeColName=${unsafeColName} is colliding with: ${acc[safeColName]}`)
                    for (let i = 1; ; i++) {
                        if (!acc[`${safeColName}_${i}`]) {
                            acc[`${safeColName}_${i}`] = unsafeColName;
                            break;
                        }
                    }
                }
                return acc;
            }, {});

        const colUnsafeToSafeMapping = Object.keys(colSafeToUnsafeMapping)
            .reduce<{ [unssafeColName: string]: string }>((acc, safeColName) => {
                const unsafeColname = colSafeToUnsafeMapping[safeColName];
                if (unsafeColname) {
                    acc[unsafeColname] = safeColName;
                }
                return acc;
            }, {})

        // Init the renamedColumns dict
        const mapping = this.renamedColumns[streamId] || {};
        this.renamedColumns[streamId] = mapping;
        Object.keys(colUnsafeToSafeMapping).forEach(unsafeColName => {
            const safeName = colUnsafeToSafeMapping[unsafeColName];
            if (safeName) {
                mapping[unsafeColName] = safeName;
            }
        });
    }

    getColumnTranslation = (
        streamId: string,
        originalColumnName: string
    ): string => {
        if (!this.renamedColumns[streamId]) {
            throw new Error(
                `StreamId=${streamId} - Columns Mapping Store is not initialized! 
                Trying to get renamed value for column '${originalColumnName}'`
            )
        }
        const value = this.renamedColumns[streamId][originalColumnName];
        if (!value) {
            throw new Error(`StreamId=${streamId} - No renamed value found for column '${originalColumnName}'`)
        }
        return value;
    }

    getUnsafeToSafeColumnMapping = (streamId: string): ColumnMappingStoreUnsafeToSafe => {
        const mapping = this.renamedColumns[streamId];
        if (!mapping) {
            throw new Error(`StreamId=${streamId} - Columns Mapping Store is not initialized!`)
        }
        return mapping;
    }

    isReady = (streamId: string): boolean => {
        if (!this.renamedColumns[streamId]) {
            return false;
        } else {
            return true;
        }
    }
}