import { CatalogFile } from "../../sdk/models/catalog";
import { logger } from "../../sdk/service/logger";
import { DestinationType, ShoreCommand, ShoreConfig, SourceType } from "../../sdk/models/models";
import { Resolver } from "../../sdk/models/resolver";
import { readAndParseJSONFile, writeFile } from "./services/files";
import { LocalSchemaHook } from "./hook/schemaHook";
import winston from "winston";
import { getAllMetrics } from "../../sdk/service/metric";
import { TargetSchemaHook } from "../../sdk/models/target/targetHook";

const { combine, prettyPrint, timestamp, errors, splat } = winston.format;

const configPath = './config.json'
const targetConfigPath = './target-config.json'
const catalogPath = './catalog.json'
const statePath = './state.json'
const metricsPath = './metrics.json'

export class LocalFilesResolver extends Resolver {
    startVPNIfNeeded(): Promise<void> {
        // We can't start the VPN locally from here as it requires root access
        // See the doc in atlantis to boot it locally on your dev station
        return Promise.resolve();
    }

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

    getConfig(
        command: ShoreCommand
    ): Promise<ShoreConfig> {
        logger.info(`📁 Using the LOCAL resolver`)

        const config = readAndParseJSONFile(configPath);

        const targetConfig = readAndParseJSONFile(targetConfigPath);

        const destination = process.env.SHORE__DESTINATION as DestinationType;
        if (!destination) {
            throw new Error(`❌ Env variable \`SHORE__DESTINATION\` is not set.
            Did you forget to configure it?
            
            Possible values are: \`GOOGLE_BIGQUERY\`, \`SNOWFLAKE\``)
        }

        if (command === `READ`) {

            if (destination === `GOOGLE_BIGQUERY`) {
                const googleCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
                if (!googleCredentials) {
                    throw new Error(`Env variable \`GOOGLE_APPLICATION_CREDENTIALS\` is not set. 
                Did you forget to configure it?

                This variable should link to a file containing the proper Google Service Account credentials.
                `)
                }
            }

            const catalog = readAndParseJSONFile(catalogPath);

            const state = readAndParseJSONFile(statePath);

            return Promise.resolve({
                command,
                destination,
                config,
                targetConfig,
                catalog,
                state
            })
        } else {
            return Promise.resolve({
                command,
                destination,
                config,
                targetConfig
            })
        }
    }

    writeCatalog(catalog: CatalogFile): Promise<void> {
        return writeFile(catalogPath, JSON.stringify(catalog))
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

        const config = readAndParseJSONFile(configPath);
        config[optionKey] = optionValue;
        return writeFile(configPath, JSON.stringify(config));

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