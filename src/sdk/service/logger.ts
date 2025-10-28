import * as winston from "winston";

import { loadResolver } from "./resolver";
export const BATCH_INTERVAL_MS = 100;

const transports = {
    console: new winston.transports.Console({
        stderrLevels: [],
        level: 'info'
    })
};

const getTransports = (): winston.transport[] => {
    return [
        transports.console
    ]
}

const winstonLogger = winston.createLogger({
    format: loadResolver().getLogFormat(),
    transports: getTransports(),
});

let isWinstonOpen = true;
const closeWinston = (cb: () => void) => {
    isWinstonOpen = false;
    winstonLogger.end();
    winstonLogger.on('finish', () => {
        setTimeout(() => {
            return cb()
        }, BATCH_INTERVAL_MS * 2)
    });
}

type LogLevel = 'info' | 'error' | 'debug' | 'warn';

const log = (
    level: LogLevel,
    message: string | any,
    ...args: any[]
): void => {
    if (isWinstonOpen) {
        winstonLogger[level](message, ...args);
    } else {
        console[level](message, ...args);
    }
};

export const logger = {
    info: (message: string | any, ...args: any[]): void => log('info', message, ...args),
    error: (message: string | any, ...args: any[]): void => log('error', message, ...args),
    debug: (message: string | any, ...args: any[]): void => log('debug', message, ...args),
    warn: (message: string | any, ...args: any[]): void => log('warn', message, ...args),
    closeWinston
}