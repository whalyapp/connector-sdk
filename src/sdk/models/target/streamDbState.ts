import dayjs, { Dayjs } from "dayjs";
import { defaultDateTimeFormat } from "../../constants/date";
import { StreamId } from "../metadata";
import { ReplicationMethod } from "../replication";
import { StreamWarehouseSyncService } from "./dbSync";
import { FlattenedSchema, TempFile } from "./models";
import { createTemporaryFileStream } from "./temporaryFile";
import * as fs from "fs";
import { ValidateFunction } from "ajv";

// This class is here to manage the State of a stream being loaded into a Warehouse
export class StreamState {
    streamId: StreamId;
    schema?: FlattenedSchema;
    dbSync: StreamWarehouseSyncService;

    batchDate: Dayjs;

    // Count rows batched in the local file, waiting for Warehouse upload
    batchedRowCount: number;
    // Local CSV files written to be sent to Warehouse
    fileToLoad: TempFile;
    // Count rows sent to Warehouse
    syncedRowCount: number;
    keyProperties: string[];

    // When a FULL_TABLE stream is loaded multiple times, the query used for the 2nd+ loads
    // needs to be different than the 1st merge query -> 1st load is dropping the existing table, 2nd+ loads are merging with the existing table (otherwise the previous load data are dropped)
    // So we need to keep track of whether we are at the first load or not
    _hasBeenLoadedYetDuringThisSync: boolean

    replicationMethod: ReplicationMethod

    // Pre-compiled ajv ValidateFunction — compiled once per schema, reused for every row
    compiledValidateFn?: ValidateFunction;

    constructor(
        streamId: StreamId, 
        dbSync: StreamWarehouseSyncService, 
        replicationMethod: ReplicationMethod, 
        ) {
        this.streamId = streamId;
        this.dbSync = dbSync;

        this.batchedRowCount = 0;
        this.fileToLoad = createTemporaryFileStream(streamId);
        this.syncedRowCount = 0;
        this.keyProperties = [];
        this.batchDate = dayjs();
        this.replicationMethod = replicationMethod;
        this._hasBeenLoadedYetDuringThisSync = false;
    }

    setSchema(schema: FlattenedSchema) {
        this.schema = schema;
    }

    getSchema(): FlattenedSchema | undefined {
        return this.schema;
    }

    setCompiledValidateFn(fn: ValidateFunction) {
        this.compiledValidateFn = fn;
    }

    getCompiledValidateFn(): ValidateFunction | undefined {
        return this.compiledValidateFn;
    }

    getBatchDate(): string {
        return this.batchDate.format(defaultDateTimeFormat);
    }

    getBatchedRowCount(): number {
        return this.batchedRowCount;
    }

    incrementBatchedRowCount() {
        this.batchedRowCount += 1;
    }

    getFileToLoad(): TempFile {
        return this.fileToLoad;
    }

    resetFileToLoad() {
        this.fileToLoad.stream.close();
        const oldPath = this.fileToLoad.path;
        // Delete the old file to make some space
        fs.unlinkSync(oldPath);
        this.fileToLoad = createTemporaryFileStream(this.streamId);
        this.batchedRowCount = 0;
    }

    getKeyProperties(): string[] {
        return this.keyProperties;
    }

    setKeyProperties(keyProperties: string[]) {
        this.keyProperties = keyProperties
    }

    getDbSync(): StreamWarehouseSyncService {
        return this.dbSync
    }

    getReplicationMethod(): ReplicationMethod {
        return this.replicationMethod
    }

    setReplicationMethod(r: ReplicationMethod) {
        this.replicationMethod = r;
    }

    setHasBeenLoadedYet() {
        this._hasBeenLoadedYetDuringThisSync = true;
    }
}