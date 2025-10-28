import winston from "winston";
import { CatalogFile } from "./catalog"
import { StateHolder } from "./models";
import { TargetSchemaHook } from "./target/targetHook";
import { type ErrorType } from "./error";

export abstract class Resolver {
    constructor() {}
    abstract checkIfCanSync(): Promise<boolean>;
    abstract markSyncStarted(): Promise<void>;
    abstract getState(): Promise<StateHolder>;
    abstract writeCatalog(catalog: CatalogFile): Promise<void>;
    abstract writeState(state: string): Promise<void>;
    abstract markSyncFailed(): Promise<void>;
    abstract markSyncComplete(): Promise<void>;
    abstract markDiscoveryComplete(): Promise<void>;
    abstract flushMetrics(): Promise<void>;
    abstract onError(errorType: ErrorType, errorText: string, errorDebugText: string): Promise<void>;
    abstract getSchemaHooks(): TargetSchemaHook[];
    abstract updateSourceValue(
        optionKey: string,
        optionValue: string,
    ): Promise<void>;
    abstract getLogFormat(): winston.Logform.Format;
}