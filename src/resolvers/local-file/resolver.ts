import { CatalogFile } from "../../sdk/models/catalog";
import { logger } from "../../sdk/service/logger";
import { StateHolder } from "../../sdk/models/models";
import { Resolver } from "../../sdk/models/resolver";
import { readAndParseJSONFile, writeFile } from "./services/files";
import { LocalSchemaHook } from "./hook/schemaHook";
import winston from "winston";
import { getAllMetrics } from "../../sdk/service/metric";
import { TargetSchemaHook } from "../../sdk/models/target/targetHook";

const { combine, prettyPrint, timestamp, errors, splat } = winston.format;

const statePath = './state.json'
const metricsPath = './metrics.json'

export class LocalFilesResolver extends Resolver {

    checkIfCanSync(): Promise<boolean> {
        return Promise.resolve(true);
    }

    markSyncStarted(): Promise<void> {
        return Promise.resolve();
    }

    onError(errorType: any, errorText: string, errorDebugText: string): Promise<void> {
        const path = `./error.json`;
        return writeFile(path, JSON.stringify({
            errorType,
            errorText,
            errorDebugText
        }))
    }

    getSchemaHooks(): TargetSchemaHook[] {
        const wlyHook = new LocalSchemaHook();
        return [wlyHook];
    }

    writeSchema(): Promise<void> {
        return Promise.resolve();
    }

    constructor() {
        super();
    }

    getState(
    ): Promise<StateHolder> {
        logger.info(`📁 Using the LOCAL resolver`)
        const state = readAndParseJSONFile(statePath);
        return Promise.resolve({
            state
        })
    }

    writeCatalog(catalog: CatalogFile): Promise<void> {
        return Promise.resolve();
    }

    writeState(state: string): Promise<void> {
        return writeFile(statePath, state)
    }

    markSyncFailed(): Promise<void> {
        logger.info(`😢 Sync has failed.`)
        return Promise.resolve();
    }

    markSyncComplete(): Promise<void> {
        logger.info(`🎉 Sync is complete.`)
        return Promise.resolve();
    }

    markDiscoveryComplete(): Promise<void> {
        logger.info(`🎉 Discovery is complete.`)
        return Promise.resolve();
    }

    async flushMetrics(): Promise<void> {
        const allMetrics = getAllMetrics();

        const metricsOuput = allMetrics
            .map((metric) => {
                return {
                    streamId: metric.getStreamId(),
                    name: metric.getName(),
                    value: metric.getValue()
                }
            })
            .map((obj) => JSON.stringify(obj))
            .join(`\n`)

        return writeFile(metricsPath, metricsOuput);
    }

    updateSourceValue(optionKey: string, optionValue: string): Promise<void> {
        logger.info(`Updating source value ${optionKey} with value ${optionValue}`, { private: true })
        return Promise.resolve();
    }

    getLogFormat(): winston.Logform.Format {

        return combine(
            timestamp(),
            errors({ stack: true }),
            splat(),
            prettyPrint()
        )
    }

}