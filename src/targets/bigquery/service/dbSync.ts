import { StreamId } from "../../../sdk/models/metadata";
import { logger } from "../../../sdk/service/logger";
import { Dataset, TableMetadata, TableField, Table, BigQuery, JobLoadMetadata } from "@google-cloud/bigquery";
import dayjs from "dayjs";
import { BqClientHolder } from "./bigquery";
import { File } from '@google-cloud/storage';
import { CloudStorageService } from "../../../services/cloud-storage";
import { safeColumnName } from "../helpers";
import chunk from "lodash/chunk.js";
import { haltAndCatchFire } from "../../../sdk/service/error";
import { StreamWarehouseSyncService } from "../../../sdk/models/target/dbSync";
import { InternalTableField, JSONSchemaFieldDefinition, WarehouseTableField } from "../../../sdk/models/target/models";
import { BigQueryConfig } from "../models/config";
import { RenameColumnStore } from "../../../sdk/models/target/renameColumnStore";
import { Semaphore } from "async-mutex";
import { gracefulExit } from "../../../sdk/service/exit";

const semaphore = new Semaphore(1);

export class BigQueryDBSync extends StreamWarehouseSyncService {

    config: BigQueryConfig;
    bqClient: BigQuery;
    bqDataset: Dataset;
    bqTable: Table;
    bqStagingTable: Table;
    tableName: string;
    stagingTableName: string;
    sqlTableId: string;
    sqlStagingTableId: string;

    constructor(
        config: BigQueryConfig,
        streamId: StreamId,
        database: string,
        schema: string,
        table: string,
        renameColumnStore: RenameColumnStore,
    ) {
        super(
            streamId,
            database,
            schema,
            table,
            renameColumnStore
        )
        this.config = config;
        this.bqClient = BqClientHolder.client(config);
        this.bqDataset = this.bqClient.dataset(schema, { location: config.location || "EU" });
        this.bqTable = this.bqDataset.table(table, { location: config.location || "EU" });
        this.tableName = table;
        this.stagingTableName = `${table}_temp`;
        this.bqStagingTable = this.bqDataset.table(this.stagingTableName, { location: config.location || "EU" });
        this.sqlTableId = `${schema}.${table}`;
        this.sqlStagingTableId = `${this.sqlTableId}_temp`;
    }

    // Implementation of abstract classes

    getSerializedRecord = (record: any): string => {
        return JSON.stringify(record) + `\n`;
    }

    safeColumnName = safeColumnName

    getWarehouseTypeFromJSONSchema = (
        definition: JSONSchemaFieldDefinition
    ): string => {

        const type = definition.type;
        const format = definition.format;

        // Converting `string | string[]` into `string[]` is easier for later processing
        let typeArr: string[];

        if (type instanceof Array) {
            typeArr = type;
        } else {
            typeArr = [type];
        }

        if (format) {
            switch (format) {
                case "date-time":
                    return "TIMESTAMP";
                case "json":
                    return "STRING";
                default:
                    throw new Error(`StreamId: ${this.streamId} -  Unsupported format: ${format}`)
            }
        }
        else if (typeArr.includes('number')) {
            return "NUMERIC"
        }
        else if (typeArr.includes('integer') && type.includes('string')) {
            return "NUMERIC"
        }
        else if (typeArr.includes('integer')) {
            return "INTEGER"
        }
        else if (typeArr.includes('boolean')) {
            return "BOOLEAN"
        }
        else if (typeArr.includes('string')) {
            return "STRING"
        }
        else if (typeArr.includes('array')) {
            const items = definition.items;
            if (items) {
                return this.getWarehouseTypeFromJSONSchema(items)
            }
            throw new Error(`StreamId: ${this.streamId} -  Unsupported array schema field definition: ${JSON.stringify(definition)}`)
        }
        else {
            throw new Error(`StreamId: ${this.streamId} -  Unsupported schema field definition: ${JSON.stringify(definition)}`)
        }
    };

    getMergeQueries = (): string[] => {

        const primaryKeyCondition = this.primaryKeys
            .map(pk => {
                return `\`sourced\`.\`${pk}\` = \`destination\`.\`${pk}\``
            })
            .join(` AND `);

        const primaryKeys = this.primaryKeys.map(pk => `\`${pk}\``).join(` ,`)

        const columnUnsafeToSafeMapping = this.renamedColumnStore.getUnsafeToSafeColumnMapping(this.streamId);

        const columns = Object.keys(columnUnsafeToSafeMapping)
            .map(column => {
                return {
                    isUnsafe: true,
                    colName: column
                }
            });
        const columnsChunks = chunk(columns, 300)
            // We need to make sure that the PKs keys are in all chunks so that they are written in the first chunk in the destination table
            // Otherwise we write "null" in the PK cols in a first batch and then we can't the proper lines in subsequent batchs
            .map(chunk => {
                this.primaryKeys.forEach(pk => {
                    if (!chunk.map(c => columnUnsafeToSafeMapping[c.colName]).includes(pk)) {
                        chunk.push({
                            isUnsafe: false,
                            colName: pk
                        });
                    }
                })
                return chunk;
            });

        return columnsChunks.map(chunk => {

            const setValues = chunk
                .map(column => {
                    if (column.isUnsafe) {
                        return `\`destination\`.\`${columnUnsafeToSafeMapping[column.colName]}\` = \`sourced\`.\`${columnUnsafeToSafeMapping[column.colName]}\``
                    } else {
                        return `\`destination\`.\`${column.colName}\` = \`sourced\`.\`${column.colName}\``
                    }
                }).join(`, `);

            const renamedCols = chunk
                .map(column => {
                    if (column.isUnsafe) {
                        return `\`${columnUnsafeToSafeMapping[column.colName]}\``
                    } else {
                        return `\`${column.colName}\``
                    }
                }).join(`, `);

            const query = `
        MERGE ${this.sqlTableId} destination
        USING (
            WITH all_staging_rows AS (
                SELECT *
                FROM ${this.sqlStagingTableId}
            ),
            numbered_rows AS (
                SELECT *, 
                    ROW_NUMBER() OVER (PARTITION BY ${primaryKeys}) as _wly_row_nb,
                    COUNT(1) OVER (PARTITION BY ${primaryKeys}) AS _wly_partition_size,
                FROM all_staging_rows
            ),
            staging_deduped AS (
                SELECT * EXCEPT(_wly_partition_size, _wly_row_nb)
                FROM numbered_rows 
                WHERE _wly_partition_size = _wly_row_nb
            )
            SELECT *
            FROM staging_deduped
        ) AS sourced
        ON ${primaryKeyCondition}
        WHEN MATCHED THEN
            UPDATE SET ${setValues}
        WHEN NOT MATCHED THEN
            INSERT (${renamedCols}) VALUES (${renamedCols});
    `
            return query;
        });
    }

    getReplaceQueries = (): string[] => {
        if (this.primaryKeys.length === 0) {
            return [
                `TRUNCATE TABLE ${this.sqlTableId};`,
                ...this.getAppendQueries()
            ];
        }
        return [
            `TRUNCATE TABLE ${this.sqlTableId};`,
            ...this.getMergeQueries()
        ];
    }

    getAppendQueries = (): string[] => {
        const columnUnsafeToSafeMapping = this.renamedColumnStore.getUnsafeToSafeColumnMapping(this.streamId);
        const columns = Object.keys(columnUnsafeToSafeMapping)
            .map(unsafeKey => `\`${columnUnsafeToSafeMapping[unsafeKey]}\``)
            .join(`, `);

        return [
            `INSERT INTO ${this.sqlTableId} (${columns}) SELECT ${columns} FROM ${this.sqlStagingTableId};`
        ];
    }

    createDatabaseAndSchemaIfNotExists = async (retryCount: number) => {
        try {
            // To avoid checking / creating the dataset multiple times when evaluating streams concurrently
            // We make sure that this portion of the code is run with a concurrency of 1
            await semaphore.runExclusive(async () => {
                const [exists] = await this.bqDataset.exists();
                if (!exists) {
                    logger.info(`🐣 Creating dataset: ${this.bqDataset.id} on BigQuery`)
                    await this.bqDataset.create();
                } else {
                    const [metadata] = await this.bqDataset.getMetadata()
                    const alreadyExistinglocation = metadata.location;
                    if (this.config.location && this.config.location !== alreadyExistinglocation) {
                        await haltAndCatchFire(
                            `unknown`,
                            `A BigQuery dataset called '${this.bqDataset.id}' already exists in location: '${alreadyExistinglocation}' 😅
                            
                            This connector is configured to load data into the location '${this.config.location}' which is not possible as 2 datasets sharing the same name can't exist in different location on Google Cloud 😿

                            To fix this issue, could you either: a. Delete the already existing dataset? b. Change the configured destination schema name to avoid the name conflict? 🙏
                            
                            Please relaunch the connector once it's done to fix the issue 🤗
                            `,
                            `
                            We have a conflict between an already existing dataset in location ${alreadyExistinglocation} and the configured location: ${this.config.location}
                            `
                        )
                        throw Error()
                    }
                    logger.info(`👋 Dataset: ${this.bqDataset.id} already exists on BigQuery, reusing it.`)
                }
            });
        } catch (err: any) {
            if (err.code === 400) {
                await haltAndCatchFire(
                    `unauthorized`,
                    `We can't connect to your BigQuery account 😔

                    Here is the message from BigQuery: ${err.message}
                    
                    Can you check that your Warehouse credentials and Source target schema are properly configured and try to sync again the source? 🙏
                    `,
                    `Got error when trying to get Dataset from BigQuery: ${err.message} - ${err.code}`
                )
                return;
            }
            if (retryCount && retryCount > this.maxRetryCount) {
                logger.error(`StreamId: ${this.streamId} - Error when checking if dataset already exists. ${err.message} - ${err.code}`)
                gracefulExit(1);
            } else {
                logger.error(`StreamId: ${this.streamId} - Error when checking if dataset already exists. Retrying... ${err.message} - ${err.code}`)
                await new Promise((resolve, reject) => setTimeout(resolve, 1000 * (retryCount)))
                await this.createDatabaseAndSchemaIfNotExists(retryCount + 1)
            }
        }
        return Promise.resolve();
    }

    createTable = async () => {

        try {
            const tableName = this.tableName;
            const schema = this.generateBigquerySchema();

            logger.info(`🐣 Creating table: ${tableName} on BigQuery`)

            const createTableOptions: TableMetadata = {
                schema
            }

            await this.bqDataset.createTable(
                tableName,
                createTableOptions
            )

            return;
        } catch (err: any) {
            throw new Error(`StreamId: ${this.streamId} - Issue when creating table in BigQuery

            Error: ${err.message}
            Stack: ${err.stack}`)
        }
    }

    addColumns = async (tableFields: InternalTableField[]): Promise<void> => {

        if (tableFields.length > 0) {
            logger.info(`🆕 Stream: ${this.streamId} - Adding following columns in BigQuery schema: ${JSON.stringify(tableFields)}`)
            const [metadata] = await this.bqTable.getMetadata();

            const bgTableFields = tableFields.map(tblField => {
                return this.getBigqueryTableFieldFromInternalSchemaFieldDefinition(tblField.name, tblField.definition)
            }).filter(fld => {
                return !!fld
            })
            const schema = metadata.schema;
            const new_schema = {
                ...schema,
                fields: schema.fields.concat(bgTableFields)
            };
            metadata.schema = new_schema;

            await this.bqTable.setMetadata(metadata);
            return;
        }

    }

    createStagingArea = async () => {

        try {
            const tableName = this.stagingTableName;

            // A temporary table from a previous load could still be there
            const [exists] = await this.bqDataset.table(tableName).exists();
            if (exists) {
                logger.info(`👴 Temporary table ${tableName} already exists, it should be a relic form the past.
                Dropping it.`)
                await this.deleteStagingArea();
            }

            const schema = this.generateBigquerySchema();
            const expirationTime = dayjs().add(1, "day").valueOf().toString();
            const createTableOptions: TableMetadata = {
                schema,
                expirationTime
            }

            logger.info(`🐣 Creating staging table: ${tableName} on BigQuery`)

            await this.bqDataset.createTable(
                tableName,
                createTableOptions
            )

            return;
        } catch (err: any) {
            throw new Error(`StreamId: ${this.streamId} - Issue when creating table in BigQuery

            Error: ${err.message}
            Stack: ${err.stack}`)
        }
    }

    loadStreamInStagingArea = async (localFilePath: string) => {

        try {

            const gcsService = new CloudStorageService(this.config.loading_deck_gcs_bucket_name);
            const file = await gcsService.uploadFileWithUniqueName(
                localFilePath,
                this.config.connector_id,
                this.streamId,
            );

            const metadata: JobLoadMetadata = {
                sourceFormat: 'NEWLINE_DELIMITED_JSON',
                writeDisposition: "WRITE_TRUNCATE",
            };

            await this.loadGCSFileInTable(this.sqlStagingTableId, file, metadata);

        } catch (err: any) {
            logger.error(`StreamId: ${this.streamId} - Error while uploading stream.`)

            if (err.code < 500) {
                await haltAndCatchFire(
                    `unauthorized`,
                    `We couldn't connect to your Cloud Storage bucket 😔

                    The error from Google is: '${err.message}' 👀

                    Could you troubleshoot your Cloud Storage configuration in Google Cloud and sync again the source? 🙏`,
                    `Got error from cloud storage lib`
                )
            }
            throw err;
        }
    }

    deleteStagingArea = () => {
        const query = `DROP TABLE IF EXISTS ${this.sqlStagingTableId};`;
        return this.runQueriesWithRetry([query]);
    }

    getTablesInSchema = async (): Promise<{ tableName: string }[]> => {
        const [bqTables] = await this.bqDataset.getTables();
        const foundTables = bqTables
            .filter(tbl => {
                return !!tbl.id
            })
            .map(bqTable => {
                return {
                    tableName: bqTable.id
                }
            });

        return foundTables as { tableName: string }[];
    }

    getTableColumnsFromWarehouse = async (): Promise<WarehouseTableField[]> => {
        const [table] = await this.bqTable.getMetadata();
        return table.schema.fields;
    }

    runQueries = async (queries: string[]): Promise<void> => {
        const sqlQuery = `
        BEGIN
            ${queries.join(`
            `)}
        END;
    `;
        await this.bqClient.query(sqlQuery);
    }

    // Specific methods
    /**
     * 
     * Generate a TableField definition object that can be passed to BigQuery APIs to define a column on a table
     * 
     * @param colName 
     * @param schemaFieldDefinition 
     * @returns 
     */
    private getBigqueryTableFieldFromInternalSchemaFieldDefinition = (
        colName: string,
        schemaFieldDefinition: JSONSchemaFieldDefinition | undefined
    ): TableField | undefined => {

        const name = colName;

        if (!schemaFieldDefinition) {
            throw new Error(`StreamId: ${this.streamId} - Schema is unknown for colName=${colName}, so we can't infer the proper BigQuery definition for this column.`)
        }
        const type = schemaFieldDefinition.type;

        // Converting `string | string[]` into `string[]` is easier for later processing
        let typeArr: string[];

        if (type instanceof Array) {
            typeArr = type;
        } else {
            typeArr = [type];
        }

        if (typeArr.includes('array')) {
            return {
                name,
                mode: "REPEATED",
                type: this.getWarehouseTypeFromJSONSchema(schemaFieldDefinition)
            }
        } else {
            // Only supported mode is NULLABLE as:
            // REQUIRED is not working great with adding columns later on so we keep NULLABLE
            let nullableMode = "NULLABLE";
            return {
                name,
                mode: nullableMode,
                type: this.getWarehouseTypeFromJSONSchema(schemaFieldDefinition)
            }
        }

    }

    private generateBigquerySchema = (): TableField[] => {
        const unsafeToSafeMappingColumnsFromColumnStore = this.renamedColumnStore.getUnsafeToSafeColumnMapping(this.streamId);
        if (!unsafeToSafeMappingColumnsFromColumnStore) {
            throw new Error(`StreamId: ${this.streamId} - There is no unsafe->safe column mapping`)
        }
        return Object.keys(unsafeToSafeMappingColumnsFromColumnStore).reduce<TableField[]>((acc, unsafeKey) => {

            const renamedColName = this.renamedColumnStore.getColumnTranslation(this.streamId, unsafeKey)!;
            const bigqueryTableField = this.getBigqueryTableFieldFromInternalSchemaFieldDefinition(renamedColName, this.flattenedSchema[unsafeKey]);
            if (bigqueryTableField) {
                acc.push(bigqueryTableField);
            }

            return acc;
        }, [])
    }

    private loadGCSFileInTable = async (
        tableName: string,
        file: File,
        metadata: JobLoadMetadata
    ): Promise<void> => {
        try {
            const [job] = await this.bqStagingTable.load(file, metadata);

            logger.info(`🚚 Loaded GCS file \`${file.id}\` in BigQuery table: ${tableName} with Job: \`${job.id}\``);
            logger.debug(`Upload Stats: ${JSON.stringify(job.statistics)}`)

            // Check the job's status for errors
            const errors = job.status?.errors;
            if (errors && errors.length > 0) {
                throw errors;
            }
        } catch (err: any) {
            logger.error(err)
            throw new Error(`StreamId: ${this.streamId} - Issue when loading file in BigQuery table | fileName: ${file.name}, tableName: ${tableName}

            Error: ${err.message}
            Stack: ${err.stack}`)
        }
    }

}