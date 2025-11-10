import { readFileSync } from "fs";
import { logger } from "./service/logger.js";

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