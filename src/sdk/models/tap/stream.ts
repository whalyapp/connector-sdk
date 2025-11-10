import dayjs, { Dayjs } from "dayjs";
import { defaultDateTimeFormat } from "../../constants/date";
import { isDatetimeType } from "../../helpers/typing";
import { logger } from "../../service/logger";
import { loadJson } from "../../utils";
import { StreamId } from "../metadata";
import { RecordMessage, ReplicationMethodMessage, SchemaMessage, StateMessage } from "../messages";
import { ReplicationMethod } from "../replication";
import { extractStateForStream, finalizeStateProgressMarkers, incrementStreamState, InputTapState, StateService } from "../state";
import { ITarget } from "../target/target";
import cloneDeep from "lodash/cloneDeep.js";
import { Schema } from "../schema";
import Bluebird from "bluebird";
import { DEFAULT_MAX_CONCURRENT_STREAMS } from "./tap";
import { CounterMetric, EXECUTION_TIME_METRIC_NAME, getCounterMetrics, MetricConfiguration, ROWS_SYNCED_METRIC_NAME } from "../../service/metric";
import { format } from "util";

/**
 * TODO: Handle non timestamp based replication key
 *
 * O: Type of a resulted row after post processing
 * C: Type of the tap configuration
 * P: For children Streams, this is the type of the parent
 */
export abstract class Stream<O = any, C = any, P = undefined> {

    // Runtime values, can't be overriden
    config: C;
    tapState: InputTapState;
    target: ITarget;

    replicationMethod: ReplicationMethod | undefined = undefined;
    selectedByDefault: boolean = true;
    STATE_MSG_FREQUENCY: number = 10;
    streamId: StreamId = "default";
    schemaPath: string | undefined = undefined;
    displayLabel: string | undefined = undefined;
    description: string | undefined = undefined;
    primaryKey: string[] = [];
    replicationKey: string | undefined = undefined;
    // When set, use the state from another stream for this stream
    useStateFromStreamId: string | undefined = undefined;

    children: Stream<any, any, O | O[]>[] = [];
    // If true, it means that the records in this stream are sorted by replicationKey.
    // If false, then the records are coming in an unsorted manner.
    isSorted: boolean = false;
    // If true, then no SCHEMA / RECORD messages will be sent for this Stream.
    // However, a STATE will still be emitted if the Stream is using an incremental sync type.
    isSilent: boolean = false;

    childConcurrency: number;

    // Metrics configuration
    rowsSyncedMetricsConf: MetricConfiguration
    executionTimeMetricsConf: MetricConfiguration

    constructor(
        config: C,
        tapState: InputTapState,
        target: ITarget,
        childConcurrency: number = DEFAULT_MAX_CONCURRENT_STREAMS
    ) {
        this.config = config;
        this.tapState = cloneDeep(tapState);
        this.target = target;
        this.childConcurrency = childConcurrency;

        // Default metric configuration
        this.rowsSyncedMetricsConf = {
            isEnabled: () => !this.isSilent,
            getStreamIds: () => [this.streamId]
        }
        this.executionTimeMetricsConf = {
            isEnabled: () => !this.isSilent,
            getStreamIds: () => [this.streamId]
        }
    }

    // No root metadata: replication config is derived from stream defaults only

    /**
     * Sync this stream
     * Called only for streams with no parents, aka. "root tap streams"
     * @returns 
     */
    sync = async (): Promise<void> => {
        try {
            const replicationMethod = this.configuredReplicationConfig().replicationMethod;
            logger.info(
                `🎬 Beginning ${replicationMethod} sync of stream '${this.streamId}'...`
            )

            await this.asyncInit();

            // Send a SCHEMA message to the downstream target
            await this._writeSchemaMessage();

            await this._writeReplicationMethodMessage();

            // Write the signpost
            await this._writeSignpostInState();

            // Sync the records themselves
            await this._syncRecords();

            // Flush the stream
            return this.flush();
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(format(`got an error while syncing streamId=%s, err: %s`, this.streamId, err.message))
            }
            throw err;
        }
    }

    flush = async (): Promise<void> => {
        const replicationMethod = this.configuredReplicationConfig().replicationMethod;
        logger.info(
            `🚽 Flushing ${replicationMethod} sync of stream '${this.streamId}' + all of its children...`
        )

        await this._flush();

        await Bluebird.map(this.children, child => {
            return child.flush();
        }, { concurrency: 3 });
    }

    // Private message authoring methods:

    /**
     * Write out a STATE message with the latest state.
     */
    _writeStateMessage = (): Promise<void> => {
        const message = new StateMessage(StateService.getInstance().get());
        return this.target.state(message);
    }

    /**
     * Write out a ACTIVATE_VERSION message.
     */
    _writeReplicationMethodMessage = async (): Promise<void> => {
        const method = this.configuredReplicationConfig().replicationMethod;
        const message = new ReplicationMethodMessage(this.streamId, method);

        await Bluebird.map(this.children, async c => {
            return c._writeReplicationMethodMessage()
        }, { concurrency: 3 })
        await this.target.replicationMethod(message);
    }

    /**
     * Write out a SCHEMA message with the stream schema.
     */
    _writeSchemaMessage = async (skipChildrenSchema?: boolean): Promise<void> => {

        if (!this.isSilent) {
            const schema = await this.getSchema();
            if (schema !== undefined) {
                const replicationConfig = this.configuredReplicationConfig();

                const message = new SchemaMessage({
                    keyProperties: this.primaryKey,
                    stream: this.streamId,
                    schema: schema.jsonSchema,
                    ...(replicationConfig.replicationKey ? { bookmarkProperties: [replicationConfig.replicationKey] } : {}),
                    ...(this.displayLabel ? { displayLabel: this.displayLabel } : {}),
                    ...(this.description ? { description: this.description } : {}),
                    ...(schema.propertiesMetadata ? { propertiesMetadata: schema.propertiesMetadata } : {})
                })
                await this.target.schema(message);
            }
        }

        if (skipChildrenSchema !== true) {
            await Bluebird.map(this.children, async (child) => {
                await child._writeSchemaMessage();
            }, { concurrency: 3 });
        }
    }

    // Private bookmarking methods

    _writeSignpostInState = async () => {
        const signpostMoment = await this.getReplicationKeySignpost();
        const signpostValue = signpostMoment?.format(defaultDateTimeFormat);

        if (signpostValue) {
            StateService.getInstance().setBookmarkSignpost(this.streamId, signpostValue);
        }
    }

    /**
     * Update state of stream with data from the provided record. 
     */
    _incrementStreamState = (latestRecord: O): void => {

        if (latestRecord) {
            const replicationConfig = this.configuredReplicationConfig()
            if ([
                "INCREMENTAL",
                "LOG_BASED",
            ].includes(replicationConfig.replicationMethod)) {
                // If the stream is using another stream state, it doesn't own the state and can't increment it
                if (this.useStateFromStreamId) {
                    return;
                }
                // If the replication method was forced, it can be that the stream is the child of anohter stream that is managing the state (ex. a paginated stream). 
                // The state is not owned by the current stream then.
                if (this.replicationMethod && !this.replicationKey) {
                    return;
                }

                // If the stream has been detected as being incremental and has no excuses for not owning its state, it should have the replicationKey
                if (!replicationConfig.replicationKey) {
                    throw new Error(`Could not detect replication key for '${this.streamId}' stream"
                        replication method=${replicationConfig.replicationMethod})`
                    )
                }

                const stateServiceInst = StateService.getInstance();
                const state = stateServiceInst.getBookmark(this.streamId);

                const newState = incrementStreamState(
                    state,
                    replicationConfig.replicationKey,
                    latestRecord,
                    this.isSorted
                )

                StateService.getInstance().setBookmark(this.streamId, newState)
            }
        }
    }

    /**
     * Return True if the stream uses a timestamp-based replication key.
     * 
     * Developers can override with `is_timestamp_replication_key = True` in
        order to force this value.
     */
    isTimestampReplicationKey = async (): Promise<boolean> => {

        const replicationConfig = this.configuredReplicationConfig()

        if (!replicationConfig.replicationKey) {
            return false;
        }

        const schema = await this.getSchema();
        if (!schema || !schema.jsonSchema || !schema.jsonSchema.properties) {
            return false;
        }

        const typeFromSchema = schema.jsonSchema["properties"][replicationConfig.replicationKey]
        if (!typeFromSchema) {
            return false;
        }

        return isDatetimeType(typeFromSchema);
    }

    /**
     * Return state timestamp if set for the stream, 
     * or `start_date` config if set, 
     * or the UNIX Epoch
     **/
    getStartingTimestamp(): Dayjs {
        const streamIdToReadFrom = this.useStateFromStreamId
            ? this.useStateFromStreamId
            : this.streamId;
        const state = extractStateForStream(this.tapState, streamIdToReadFrom);

        const startDate = (this.config as any).start_date as string | undefined;
        const replicationConfig = this.configuredReplicationConfig();

        logger.debug(`${this.streamId}: state.replicationKeyValue: ${state.replicationKeyValue}, 
        state.replicationKey: ${state.replicationKey},
        this.replicationKey: ${replicationConfig.replicationKey}`)

        if (state.replicationKeyValue) {
            logger.debug(`${this.streamId} - getStartingTimestamp -> Returning replication key value: ${state.replicationKeyValue}`)
            return dayjs(state.replicationKeyValue);
        } else if (startDate) {
            logger.debug(`${this.streamId} - getStartingTimestamp -> Returning config start date: ${startDate}`)
            return dayjs(startDate)
        } else {
            logger.debug(`${this.streamId} - getStartingTimestamp -> Returning EPOCH (1970)`)
            return dayjs(0);
        }
    }

    /**
     * Return the max allowable bookmark value for this stream's replication key.
     * 
     * For timestamp-based replication keys, this defaults to `dayjs()`. For
     * non-timestamp replication keys, default to `undefined`.
     * 
     * Override this value to prevent bookmarks from being advanced in cases where we
     * may only have a partial set of records.
     */
    getReplicationKeySignpost = async (): Promise<Dayjs | undefined> => {

        if (await this.isTimestampReplicationKey()) {
            return dayjs()
        }

        return undefined
    }

    /**
     * Return the default replication method for the stream that will be used to write the catalog.
     */
    defaultReplicationConfig = (): {
        replicationMethod: ReplicationMethod,
        replicationKey: string | undefined,
        // When replication method is forced, it means that end user can't override it.
        isForced: boolean
    } => {
        if (this.replicationMethod) {
            return {
                replicationMethod: this.replicationMethod,
                replicationKey: this.replicationKey,
                isForced: true
            }
        }
        if (this.replicationKey || this.useStateFromStreamId) {
            return {
                replicationMethod: ReplicationMethod.INCREMENTAL,
                replicationKey: this.replicationKey,
                isForced: true
            }
        }

        return {
            replicationMethod: ReplicationMethod.FULL_TABLE,
            replicationKey: undefined,
            isForced: false
        }
    }

    /**
     * Return the configured replication method that will be used for the sync.
     */
    configuredReplicationConfig = (): {
        replicationMethod: ReplicationMethod,
        replicationKey: string | undefined
    } => {
        const defaults = this.defaultReplicationConfig();
        return {
            replicationMethod: defaults.replicationMethod,
            replicationKey: defaults.replicationKey
        }
    }

    // Private sync methods:
    async _syncRecords(parent?: P): Promise<void> {
        let rowsSent = 0;

        let recordSyncedMetrics: CounterMetric[] = [];
        if (this.rowsSyncedMetricsConf.isEnabled() === true) {
            recordSyncedMetrics = getCounterMetrics(
                ROWS_SYNCED_METRIC_NAME,
                this.rowsSyncedMetricsConf.getStreamIds
                    ? this.rowsSyncedMetricsConf.getStreamIds()
                    : []
            )
        }

        let executionTimeMetrics: CounterMetric[] = [];
        if (this.executionTimeMetricsConf.isEnabled() === true) {
            executionTimeMetrics = getCounterMetrics(
                EXECUTION_TIME_METRIC_NAME,
                this.executionTimeMetricsConf.getStreamIds
                    ? this.executionTimeMetricsConf.getStreamIds()
                    : []
            )
        }

        const startTime = new Date().getTime();

        for await (const row of this._getRecords(parent)) {

            if ((rowsSent - 1) % this.STATE_MSG_FREQUENCY == 0) {
                await this._writeStateMessage()
            }

            const recordMessage = new RecordMessage(
                { ...row },
                this.streamId
            )

            if (!this.isSilent) {
                await this.target.record(recordMessage);
            }

            await Bluebird.map(this.children, async (child) => {
                await child.asyncInit(row);
                return child._syncRecords(row);
            },
                {
                    concurrency: this.childConcurrency
                });
            this._incrementStreamState(row);
            recordSyncedMetrics.forEach((metric) => {
                metric.increment();
            })
            rowsSent += 1;
        }

        const stateServiceInst = StateService.getInstance();
        const state = stateServiceInst.getBookmark(this.streamId);
        const newState = finalizeStateProgressMarkers(state);
        stateServiceInst.setBookmark(this.streamId, newState);

        if (!parent) {
            logger.info(`✅ Completed sync for stream: ${this.streamId} (${rowsSent} records)`);
        } else {
            logger.debug(`✅ Completed sync for sub-stream: ${this.streamId} (${rowsSent} records)`);
        }

        await this._writeStateMessage();
        const endTime = new Date().getTime();
        const executionTimeMs = endTime - startTime;
        executionTimeMetrics.forEach(metric => {
            metric.increment(executionTimeMs);
        })

    }

    // Overridable Methods

    asyncInit(parent?: P): Promise<void> {
        return Promise.resolve()
    }

    /**
     * Return the stream schema.
     * 
     * Can be overriden to return a dynamic schema
     */
    getSchema(): Promise<Schema | undefined> {
        logger.debug(`stream: ${this.streamId} - getSchema() is called`)
        if (this.schemaPath) {
            const schema = loadJson(`schemas/${this.schemaPath}`)
            return Promise.resolve({ jsonSchema: schema });
        } else {
            if (this.isSilent) {
                return Promise.resolve(undefined);
            }
            throw new Error(`Stream=${this.streamId} - No schema path was passed.
                    Either you forgot to fill the the \`schemaPath\` property,
                    or to override the getSchema() method.`)
        }
    }

    getRowCount(): Promise<number | undefined> {
        return Promise.resolve(undefined)
    }

    /**
     * Abstract row generator function. Must be overridden by the child class.
     */
    _getRecords(parent?: P): AsyncIterable<O> {
        throw new Error(`Stream._getRecords() - Should be implemented by child class`);
    }

    /**
     * Return the list of keys that can be configured in the UI by the end user as the replication key
     * @returns 
     */
    getValidReplicationKeys(): Promise<string[]> {
        return Promise.resolve([]);
    }

    /**
     * Called at the end of the sync. Use to flush all records before closing the Stream.
     * @returns 
     */
    async _flush(): Promise<void> {
        await Promise.resolve();
    }
}