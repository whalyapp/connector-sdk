import { ReplicationMethodMessage, RecordMessage, SchemaMessage, StateMessage } from "../messages";
import { TargetSchemaHook, TargetSchemaHookInput } from "./targetHook";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import dayjs, { Dayjs } from "dayjs";
import { RenameColumnStore, SafeColumnNameConverterFn } from "./renameColumnStore";
import { StreamState } from "./streamDbState";
import { logger } from "../../service/logger";
import { MissingSchemaError, SchemaValidationError } from "./error";
import { addWhalyFields, removeParasiteProperties } from "./record";
import { BaseConfig, DEFAULT_SYNCED_AT_COLUMN, FlattenedSchema } from "./models";
import { flattenSchema } from "./schema";
import { StreamWarehouseSyncService } from "./dbSync";
import { Semaphore } from "async-mutex";
import { ReplicationMethod } from "../replication";
import Bluebird from "bluebird";
import { StateProvider } from "../state-provider/types";
import { StreamId } from "../metadata";

const semaphore = new Semaphore(1);

export abstract class ITarget<C extends BaseConfig = BaseConfig> {
    config: C;
    syncedAtColumnName: string;
    syncedAtColumnUseLegacyStringType: boolean;
    schemaHooks: TargetSchemaHook[]
    syncTime: Dayjs;
    stateProvider: StateProvider;

    // Latest state message received from the Tap
    // Not yet flushed as we didn't upload the stream data since receiving it 
    batchedState: any;

    // Latest "flushed" state message
    // A state message is flushed when we do a stream upload.
    flushedState: any;

    renameColumnStore: RenameColumnStore;

    streams: {
        [streamName: string]: StreamState
    }

    // JSON Schema validator (ajv — pre-compiles schemas into optimized JS functions)
    ajv: Ajv

    constructor(config: C, stateProvider: StateProvider) {
        this.config = config;
        this.syncedAtColumnName = config.syncedAtColumnName ?? DEFAULT_SYNCED_AT_COLUMN;
        this.syncedAtColumnUseLegacyStringType = config.syncedAtColumnUseLegacyStringType ?? false;
        this.stateProvider = stateProvider;
        this.schemaHooks = [];

        this.streams = {}

        this.batchedState = {}
        this.flushedState = {}

        this.ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
        this.syncTime = dayjs();

        this.renameColumnStore = new RenameColumnStore()
    }

    ///////////////////////////////////////////
    //// To be overriden by child classes /////
    ///////////////////////////////////////////
    static requiredConfigKeys: string[] = [];
    // Generate instance of DBSync
    abstract newDBSyncInstance: (
        streamId: StreamId,
        database: string,
        schema: string,
        table: string
    ) => StreamWarehouseSyncService;
    // Function to render safe table names
    abstract genTableName: (streamId: string) => string;
    // Function to render safe column names
    abstract safeColumnNameConverter: SafeColumnNameConverterFn;
    // Convert the date values of a record into valid ones for the Warehouse
    abstract validateDateRange: (reacord: any, schema: FlattenedSchema) => any;
    // Convert the number values of a record into valid ones for the Warehouse
    abstract convertNumberIntoDecimal: (record: any, schema: FlattenedSchema) => any;

    ////////////////////////////////////////////
    /////////// Implementation /////////////////
    ////////////////////////////////////////////

    // Analyze schema changes to determine if they are breaking or non-breaking
    private analyzeSchemaChanges = (
        previousSchema: FlattenedSchema,
        newSchema: FlattenedSchema,
        streamId: string
    ): { hasBreakingChanges: boolean; changes: string[] } => {
        const changes: string[] = [];
        let hasBreakingChanges = false;

        // Get all column names from both schemas
        const prevColumns = new Set(Object.keys(previousSchema).filter(col => col !== this.syncedAtColumnName));
        const newColumns = new Set(Object.keys(newSchema).filter(col => col !== this.syncedAtColumnName));

        // Check for new columns (non-breaking)
        for (const columnName of newColumns) {
            if (!prevColumns.has(columnName)) {
                changes.push(`Added column '${columnName}'`);
            }
        }

        // Check for removed columns (breaking)
        for (const columnName of prevColumns) {
            if (!newColumns.has(columnName)) {
                changes.push(`Removed column '${columnName}'`);
                hasBreakingChanges = true;
            }
        }

        // Check for type changes in existing columns (breaking)
        for (const columnName of prevColumns) {
            if (newColumns.has(columnName)) {
                const prevType = previousSchema[columnName];
                const newType = newSchema[columnName];

                // Compare the type definitions
                if (JSON.stringify(prevType) !== JSON.stringify(newType)) {
                    changes.push(`Changed type of column '${columnName}'`);
                    hasBreakingChanges = true;
                }
            }
        }

        if (changes.length === 0) {
            changes.push('No schema changes detected');
        }

        logger.debug(`StreamId=${streamId} - Schema analysis: ${hasBreakingChanges ? 'BREAKING' : 'NON-BREAKING'} changes found: ${changes.join(', ')}`);

        return { hasBreakingChanges, changes };
    }

    // Serialize a RECORD message into a line that will be uploaded in the staging area
    getSerializedRecord = (streamId: string, record: any): string => {
        const stream = this.streams[streamId];
        if (!stream) {
            throw new MissingSchemaError(`A record for stream:\`${streamId}\` was encountered before a corresponding schema.`, streamId)
        }
        return stream.getDbSync().getSerializedRecord(record)
    }

    record = async (message: RecordMessage): Promise<void> => {
        try {

            const streamId = message.stream;
            const stream = this.streams[streamId];

            if (!stream) {
                throw new MissingSchemaError(`A record for stream:\`${streamId}\` was encountered before a corresponding schema.`, streamId)
            }

            // To avoid getting any conflicts when loading data in the warehouse, we run a semaphore to have a concurrency of 1
            // Only check every 10,000 rows to avoid semaphore acquisition overhead on every single row
            // (intermediate batch threshold is 1,000,000 rows, so checking every 10,000 is more than sufficient)
            if (stream.getBatchedRowCount() % 10_000 === 0) {
                await semaphore.runExclusive(async () => {
                    const shouldUploadIntermediateBatch = this.shouldUploadIntermediateBatch(streamId)
                    if (shouldUploadIntermediateBatch) {
                        await this.loadAllStreamsInWarehouse({ isFinalLoad: false })
                    }
                })
            }

            const record = message.record;
            const schema = stream.getSchema();

            if (!schema) {
                logger.warn(`Stream: ${streamId} - Received a RECORD message while schema is undefined. Dropping message.`)
                return;
            }

            const recordWithoutParasiteProperties = removeParasiteProperties(record, schema);

            const recordWithWhalyFields = addWhalyFields(recordWithoutParasiteProperties, stream.getBatchDate(), this.syncedAtColumnName);

            // Checking that the RECORD is valid compared to the previously received SCHEMA.
            // Uses a pre-compiled ajv ValidateFunction (compiled once in schema()) for maximum throughput.
            const validateFn = stream.getCompiledValidateFn();
            if (validateFn && !validateFn(recordWithWhalyFields)) {
                throw new SchemaValidationError(`Stream: ${streamId} - Record is not valid according to schema.
                Validation errors: ${JSON.stringify(validateFn.errors)}

                Record: ${JSON.stringify(recordWithoutParasiteProperties)}
                Schema: ${JSON.stringify(stream.getSchema())}`, streamId, validateFn.errors ?? [])
            }

            // Making sure that the date are in valid range supported by Warehouse
            const recordWithValidDate = this.validateDateRange(recordWithWhalyFields, schema);
            // Working with Decimal.js is better as the JS `number` type is quite imprecise
            const recordWithDecimal = this.convertNumberIntoDecimal(recordWithValidDate, schema)

            // Columns should be renamed to:
            // - Be "safe" for Warehouse
            // - Handle the case where there are conflicts in column names after sanitization
            // - There is a column versionning due to a column type change since the last sync
            const dbSyncInstance = stream.getDbSync();
            const recordWithrenamedColumns = dbSyncInstance.renameColumns(recordWithDecimal);

            const serializedRecord = this.getSerializedRecord(streamId, recordWithrenamedColumns);

            return new Promise((resolve, reject) => {
                stream.getFileToLoad().stream.write(serializedRecord, (error) => {
                    if (error) {
                        reject(error);
                    }

                    stream.incrementBatchedRowCount();
                    resolve();
                });
            })

        } catch (err) {
            logger.error(`Error when handling "record" message`);
            throw err;
        }
    }

    private initStreamStateAndSyncService(
        streamId: string,
        replicationMethod?: ReplicationMethod
    ): void {
        const dbSyncInstance = this.newDBSyncInstance(
            streamId,
            this.config.database,
            this.config.schema,
            this.genTableName(streamId)
        )
        this.streams[streamId] = new StreamState(
            streamId,
            dbSyncInstance,
            replicationMethod || ReplicationMethod.FULL_TABLE
        );
    }

    replicationMethod = (message: ReplicationMethodMessage): void => {

        try {
            logger.info(`👈 Received replicationMethod message: %j`, message)
            const streamId = message.stream;
            if (!this.streams[streamId]) {
                this.initStreamStateAndSyncService(streamId, message.replication)
            } else {
                this.streams[streamId].setReplicationMethod(message.replication);
            }
        } catch (err) {
            logger.error(`Error when handling "replicationMethod" event`)
            throw err;
        }
    }

    schema = async (message: SchemaMessage): Promise<void> => {

        try {
            const streamId = message.stream;

            logger.info(`Stream: ${streamId} - Got a SCHEMA message from the tap`);
            logger.debug(`Stream: ${streamId} - Got a SCHEMA message from the tap: %j`, message);

            if (!this.streams[streamId]) {
                this.initStreamStateAndSyncService(streamId)
            } else {
                // Load the previous batched data as there can be schema changes
                const prevStreamState = this.streams[streamId];
                if (prevStreamState.batchedRowCount > 0) {
                    const prevSchema = prevStreamState.getSchema();
                    if(prevSchema) {
                        // Flatten the new schema to compare with the previous one
                        const newFlattenedSchema = flattenSchema(streamId, message.schema);
                        // Check if schema changes are breaking or non-breaking
                        const { hasBreakingChanges, changes } = this.analyzeSchemaChanges(prevSchema, newFlattenedSchema, streamId);
                        if (hasBreakingChanges) {
                            logger.info(`🔥 StreamId=${streamId} - Detected BREAKING schema changes: ${changes.join(', ')}. Loading batched records before applying new schema.`);
                            await ITarget.uploadSingleStreamToWarehouse(prevStreamState);
                        } else {
                            logger.info(`✅ StreamId=${streamId} - Detected NON-BREAKING schema changes: ${changes.join(', ')}. Continuing without uploading batched records.`);
                        }
                    }
                }
            }

            const streamState = this.streams[streamId];
            if (!streamState) {
                throw new MissingSchemaError(`Stream: ${streamId} - Received SCHEMA message before stream state was initialized.`, streamId)
            }
            const schema = flattenSchema(streamId, message.schema);

            // Add synced-at column
            schema[this.syncedAtColumnName] = this.syncedAtColumnUseLegacyStringType
                ? { type: ["null", "string"] }
                : { format: "date-time", type: ["null", "string"] }

            const dbSync = streamState.getDbSync();
            Object.keys(schema).forEach(fieldUnsafeKey => {
                // Remove the key associated to no warehouse type
                const fieldDef = schema[fieldUnsafeKey];
                const targetWarehouseType = fieldDef ? dbSync.getWarehouseTypeFromJSONSchema(fieldDef) : undefined;

                if (!targetWarehouseType) {
                    delete schema[fieldUnsafeKey]
                }
            })

            streamState.setSchema(schema);
            streamState.setCompiledValidateFn(this.ajv.compile({ type: "object", properties: schema }));

            const streamReplicationMethod = this.streams[streamId]?.getReplicationMethod();
            if (message.keyProperties.length === 0 && streamReplicationMethod !== ReplicationMethod.APPEND) {
                throw new Error(`StreamId: ${message.stream} - \`key_properties\` field is required and can't be empty in SCHEMA message.
            Received SCHEMA message: ${JSON.stringify(message)}`)
            }

            streamState.setKeyProperties(message.keyProperties);

            await dbSync.updateSchemaInWarehouse(schema, message.keyProperties);

            const {
                database: databaseName,
                schema: schemaName
            } = this.config;

            const tableName = this.genTableName(streamId);

            const formattedRelationshipMessage: SchemaMessage = {
                ...message,
                keyProperties: message.keyProperties.map(k => {
                    const translation = streamState.getDbSync().renamedColumnStore.getColumnTranslation(message.stream, k);
                    if (translation) {
                        return translation;
                    }
                    return k
                })
            }

            await Bluebird.map(this.schemaHooks, async (hook) => {
                const input: TargetSchemaHookInput = {
                    databaseName,
                    schemaName,
                    tableName,
                    message: formattedRelationshipMessage,
                }
                await hook.writeSchema(input);
            }, { concurrency: 3 })

            return Promise.resolve();
        } catch (err) {
            logger.error(`Error when handling schema event.`, err)
            throw err;
        }
    }

    state = (message: StateMessage): Promise<void> => {

        try {
            this.batchedState = message.value;

            if (!this.flushedState) {
                this.flushedState = Object.assign({}, this.state);
            }
            return Promise.resolve()
        } catch (err) {
            logger.error(`Error while handling state event.`)
            throw err;
        }
    }

    complete = async (): Promise<void> => {

        try {
            logger.info(`👍 Data Extraction is complete. Will load remaining batched stream records.`)

            await this.loadAllStreamsInWarehouse({ isFinalLoad: true });
            return Promise.resolve();
        } catch (err) {
            logger.error(`Error while handling complete event.`)
            throw err;
        }
    }

    private shouldUploadIntermediateBatch = (streamId: string): boolean => {
        const stream = this.streams[streamId];
        if (!stream) {
            return false;
        }
        const batchedRecords = stream.getBatchedRowCount()
        const method = stream.getReplicationMethod();
        if ((method === "INCREMENTAL" || method === "APPEND") && batchedRecords > 1_000_000) {
            logger.info(`🧊 Stream=${streamId} has reached the maximum amount of batched records. We'll trigger a flush of ALL streams in the Warehouse.`)
            return true;
        } else {
            return false;
        }
    }

    private loadAllStreamsInWarehouse = async (opts: { isFinalLoad: boolean }): Promise<void> => {
        logger.info(`🚛🚛🚛 Loading ALL Streams in Warehouse.`)
        const { isFinalLoad } = opts;
        const streamsWithRemainingRecords = Object
            .keys(this.streams)
            .filter(streamId => {
                // FULL TABLE streams are removed from the load if it's not the final load
                const s = this.streams[streamId];
                if (!s) {
                    return false;
                }
                if (!isFinalLoad && s.getReplicationMethod() === "FULL_TABLE") {
                    return false;
                }
                return s.getBatchedRowCount() > 0
            });

        if (streamsWithRemainingRecords.length > 0) {
            this.flushedState = await this.uploadStreamsToWarehouse(streamsWithRemainingRecords)
        }

        if (Object.keys(this.flushedState).length > 0) {
            await this.emitState(Object.assign({}, this.flushedState))
            // Special case where nothing was written in the warehouse (nothing to sync then)
            // We keep the previous state
        } else {
            await this.emitState(Object.assign({}, this.state))
        }
    }

    private emitState = (state: any): Promise<void> => {
        return this.stateProvider.writeState(JSON.stringify(state));
    }

    private uploadStreamsToWarehouse = async (
        streamsToUpload: string[]
    ) => {

        try {
            await Bluebird.map(streamsToUpload, async (streamId) => {
                logger.info(`📤 Upload stream: ${streamId} to Warehouse`)
                const streamState = this.streams[streamId];
                if (streamState) {
                    await ITarget.uploadSingleStreamToWarehouse(streamState)
                }
            }, { concurrency: 3 });

            return this.batchedState;
        } catch (err) {
            logger.error(`Error while uploading all streams + merging them.`)
            throw err;
        }
    }

    static uploadSingleStreamToWarehouse = async (
        streamState: StreamState
    ) => {

        const dbSync = streamState.getDbSync();

        try {
            const replicationMethod = streamState.getReplicationMethod();
            const fileToLoad = streamState.getFileToLoad();

            await dbSync.createStagingArea();
            await dbSync.loadStreamInStagingArea(fileToLoad.path);
            await dbSync.mergeTempTableWithDestination(replicationMethod);
            await dbSync.deleteStagingArea();
            streamState.setHasBeenLoadedYet();
            streamState.resetFileToLoad();
        } catch (err) {
            if (err instanceof Error) {
                logger.error(`StreamId=${dbSync.streamId} - Couldn't upload stream due to an error: %s`, err.message);
                throw err;
            } else {
                throw new Error('Unknown error')
            }
        }
    }
}