import { logger } from "../../service/logger";
import { StreamId } from "../metadata";
import { ReplicationMethod } from "../replication";
import { FlattenedSchema, InternalTableField, JSONSchemaFieldDefinition, WarehouseTableField } from "./models";
import { RenameColumnStore } from "./renameColumnStore";
import retry from 'async-retry';

// This class is a Stateless interface with the APIs of a Warehouse when it comes to dealing with
// loading a stream into a table.

// TODO: Move flattenedSchema + renamedColumnStore into the StreamDbState class.
export abstract class StreamWarehouseSyncService {

    streamId: StreamId;
    database: string;
    schema: string;
    table: string;

    flattenedSchema: FlattenedSchema;
    primaryKeys: string[];
    maxRetryCount = 5;

    renamedColumnStore: RenameColumnStore;

    constructor(
        streamId: StreamId,
        database: string,
        schema: string,
        table: string,
        renameColumnStore: RenameColumnStore
    ) {
        this.streamId = streamId;
        this.database = database;
        this.schema = schema;
        this.table = table;

        this.primaryKeys = [];
        this.flattenedSchema = {};
        this.renamedColumnStore = renameColumnStore;
    }

    /////////////////////////////////////////////////////////////////
    ///////// Functions to be implented for each Warehouse //////////
    /////////////////////////////////////////////////////////////////

    // Function to adapt to the Warehouse SQL dialect
    abstract safeColumnName: (unsafe: string) => string;
    abstract getWarehouseTypeFromJSONSchema: (definition: JSONSchemaFieldDefinition) => string | undefined;
    getcolumnNameWithTypeSuffix(colName: string, warehouseType: string | undefined): string {
        return `${colName}__${warehouseType}`
    }
    // In order to not overload Warehouse, we update the destination table by chunks of columns as updating all the columns at once is generating a too complex query
    abstract getMergeQueries: () => string[]
    abstract getReplaceQueries: () => string[]

    // Functions to provision the tables, columns, etc.
    abstract createDatabaseAndSchemaIfNotExists: (retryCount: number) => Promise<void>;
    abstract createTable: () => Promise<void>;
    abstract addColumns: (fields: InternalTableField[]) => Promise<void>;

    // Functions to deal with the staging area that will be used to load data in the Warehouse
    abstract createStagingArea: () => Promise<void>;
    abstract loadStreamInStagingArea: (localFilePath: string) => Promise<void>;
    abstract deleteStagingArea: () => Promise<void>;

    // Function to read from the Warehouse
    abstract getTablesInSchema: () => Promise<{ tableName: string }[]>;
    abstract getTableColumnsFromWarehouse: () => Promise<WarehouseTableField[]>;

    // Function to execute queries on the warehouse
    abstract runQueries: (queries: string[]) => Promise<void>;

    // Function to serialize the record
    abstract getSerializedRecord: (record: any) => string;

    // Orchestration functions
    updateSchemaInWarehouse = async (
        flattenedSchema: FlattenedSchema,
        primaryKeys: string[]
    ) => {
        await this.createDatabaseAndSchemaIfNotExists(0);

        this.flattenedSchema = flattenedSchema;

        this.renamedColumnStore.computeColumnNameForStream(
            this.streamId,
            flattenedSchema
        )

        this.primaryKeys = primaryKeys.map(pk => {
            return this.renamedColumnStore.getColumnTranslation(this.streamId, pk)!;
        });

        await this.syncTableSchemaWithWarehouse();
    }

    renameColumns(record: any): any {
        const renamedColsRecord: any = {}

        Object.keys(record).forEach(originalColName => {
            renamedColsRecord[this.renamedColumnStore.getColumnTranslation(this.streamId, originalColName)!] = record[originalColName]
        })
        return renamedColsRecord;
    }

    // Function to execute queries on the warehouse
    protected runQueriesWithRetry = async (queries: string[]): Promise<void> => {
        await retry(
            async () => {
                await this.runQueries(queries);
            },
            {
                retries: 5,
            }
        );
    };

    private syncTableSchemaWithWarehouse = async () => {

        const tables = await this.getTablesInSchema();
        const foundTables = tables.filter(table => this.table === table.tableName);

        if (foundTables.length === 0) {
            logger.info(`🐣 Database: \`${this.database}\`, Schema: \`${this.schema}\`, Table: \`${this.table}\` does not exist in Warehouse. Creating it...`)
            await this.createTable();
        } else if (foundTables.length === 1) {
            logger.info(`👋 Database: \`${this.database}\`, Schema: \`${this.schema}\`, Table: \`${this.table}\` already exists. Updating the columns if needed.`);
            await this.updateTableColumns();
        }
    }

    /**
     * When there is a conflict between the synced data type and the data type of an
     * already existing column in the Warehouse, this create a new column in Warehouse with the new
     * datatype as suffix.
     * 
     * This refer the fact that data should now be synced with the new column.
     * 
     * @param tableFields 
     */
    private addVersionedColumns = async (tableFields: InternalTableField[]) => {

        if (tableFields.length > 0) {
            logger.info(`🛂 Stream: ${this.streamId} - Versionning following columns in Warehouse schema: ${JSON.stringify(tableFields)}`)

            const columnsFromWarehouse = await this.getTableColumnsFromWarehouse();
            const columnNamesFromWarehouse = columnsFromWarehouse.map(col => col.name);

            let columnsToBeAddedInWarehouse: InternalTableField[] = [];
            tableFields.forEach(tblField => {
                const safeName = tblField.name as string;
                const warehouseTypeToBeUsed = this.getWarehouseTypeFromJSONSchema(tblField.definition)
                const columnNameWithTypeSuffix = this.getcolumnNameWithTypeSuffix(safeName, warehouseTypeToBeUsed)

                // Rewrite the safe mapping of the column to the versionned column
                this.renamedColumnStore.getUnsafeToSafeColumnMapping(this.streamId)[tblField.unsafeName] = columnNameWithTypeSuffix;

                if (!columnNamesFromWarehouse.includes(columnNameWithTypeSuffix)) {
                    columnsToBeAddedInWarehouse.push({
                        unsafeName: columnNameWithTypeSuffix,
                        name: columnNameWithTypeSuffix,
                        definition: tblField.definition
                    })
                }
            })

            if (columnsToBeAddedInWarehouse.length > 0) {
                await this.addColumns(columnsToBeAddedInWarehouse);
            }
        }
    }

    private updateTableColumns = async () => {

        const columnsFromWarehouse = await this.getTableColumnsFromWarehouse();
        const columnNamesFromWarehouse = columnsFromWarehouse.map(col => col.name);

        const columnsMappingStore = this.renamedColumnStore.getUnsafeToSafeColumnMapping(this.streamId);
        const columnsToAdd: InternalTableField[] = Object.keys(columnsMappingStore)
            .filter(unsafeColumnKey => {
                const safeColumnName = columnsMappingStore[unsafeColumnKey];
                if (!safeColumnName) {
                    return false;
                }
                return !columnNamesFromWarehouse.includes(safeColumnName);
            })
            .map(unsafeColumnKey => {
                const safeColumnName = columnsMappingStore[unsafeColumnKey];
                const definition = this.flattenedSchema[unsafeColumnKey];
                if (!safeColumnName || !definition) {
                    return undefined as unknown as InternalTableField;
                }
                return {
                    unsafeName: unsafeColumnKey,
                    name: safeColumnName,
                    definition
                }
            })
            .filter((item): item is InternalTableField => !!item)

        await this.addColumns(columnsToAdd);

        const columnsToVersion: InternalTableField[] = Object.keys(this.flattenedSchema)
            // We keep only the columns already declared in Warehouse but with a different type
            .filter(unsafeColumnKey => {
                const definition = this.flattenedSchema[unsafeColumnKey];
                if (!definition) {
                    return false;
                }
                const warehouseTypeToBeUsed = this.getWarehouseTypeFromJSONSchema(definition)
                if (warehouseTypeToBeUsed) {
                    const safeName = this.safeColumnName(unsafeColumnKey);
                    if (columnNamesFromWarehouse.includes(safeName)) {
                        const columnFromWarehouse = columnsFromWarehouse.find(col => col.name === safeName);

                        if (!columnFromWarehouse) {
                            throw new Error(`We can't find in Warehouse schema any column definition for colName: ${safeName}`);
                        }

                        const { type } = columnFromWarehouse;

                        if (warehouseTypeToBeUsed !== type) {
                            return true;
                        }
                    }
                }
                return false;
            })
            .map(unsafeColumnKey => {
                const definition = this.flattenedSchema[unsafeColumnKey];
                if (!definition) {
                    return undefined as unknown as InternalTableField;
                }
                return {
                    unsafeName: unsafeColumnKey,
                    name: this.safeColumnName(unsafeColumnKey),
                    definition
                }
            })
            .filter((tableField): tableField is InternalTableField => !!tableField);

        await this.addVersionedColumns(columnsToVersion);

    }

    mergeTempTableWithDestination = async (
        replicationMethod: ReplicationMethod
    ) => {

        let mergeQueries: string[] = [];
        if (replicationMethod === "FULL_TABLE") {
            mergeQueries = this.getReplaceQueries();
        } else if (replicationMethod === "INCREMENTAL") {
            mergeQueries = this.getMergeQueries();
        } else if (replicationMethod === "LOG_BASED") {
            mergeQueries = this.getMergeQueries();
        }

        logger.info(`🍆 Table=${this.table} - Merging staging data with method ${replicationMethod}`);
        logger.debug(`Table=${this.table} - Merge queries: %j`, mergeQueries);

        await this.runQueriesWithRetry(mergeQueries);

    }

}