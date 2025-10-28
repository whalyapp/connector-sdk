import { readFileSync } from "fs";
import { type CatalogFile } from "./models/catalog.js";
import { logger } from "./service/logger.js";
import { type ShoreConfig } from "./models/models.js";
import { Resolver } from "./models/resolver.js";

export const writeStateFile = (resolver: Resolver, state: string): Promise<void> => {
    logger.info(`📝 Writing the state file.`)
    return resolver.writeState(state);
}

export const writeCatalogFile = (resolver: Resolver, catalog: CatalogFile): Promise<void> => {
    logger.info(`📝 Writing the catalog`)
    return resolver.writeCatalog(catalog);
}

export const loadShoreConfig = (
    resolver: Resolver
): Promise<ShoreConfig> => {

    const command = process.env.SHORE__COMMAND;
    if (!command) {
        throw new Error(`Env variable \`SHORE__COMMAND\` is not set. 
        Did you forget to configure it?

        Possible values are: \`DISCOVER\`, \`READ\``)
    }

    if (command === `DISCOVER`) {
        logger.info(`🔎 Mode: discovery
        Shore will detect the available streams in the source and their configuration.`)
    } else if (command === `READ`) {
        logger.info(`🔁 Mode: Synchronizing data
        Shore will extract and push data from the source to the destination.`)
    } else {
        throw new Error(`Command: \`${command}\` is not supported.
        Did you properly configured env variable \`SHORE__COMMAND\`?`)
    }

    return resolver.getConfig(command);

}

function readFile(fileName: string, filePath: string) {
    try {
        return readFileSync(filePath);
    } catch (err) {
        logger.error(`Can't open file: \`${fileName}\` at path: \`${filePath}\`. Is it at the proper place?`)
        throw err;
    }
}

function parseFileContent(fileName: string, fileContent: Buffer) {
    try {
        return JSON.parse(fileContent.toString());
    } catch (err) {
        logger.error(`Can't parse file: \`${fileName}\` as JSON. Is it properly formatted?`)
        throw err;
    }
}

export const loadJson = (fileName: string): any => {
    const filePath = process.cwd() + `/` + fileName
    const fileContent = readFile(fileName, filePath);
    return parseFileContent(fileName, fileContent);
}

export const loadSchema = (streamId: string) => {
    const schema = loadJson(`schemas/${streamId}.json`)
    return schema;
}

export const checkRequiredConfigKeys = (args: any, requiredConfigKeys: string[]) => {

    requiredConfigKeys.forEach(configKey => {
        if (!args[configKey]) {
            throw new Error(`Config is missing required key: ${configKey}`)
        }
    })

}