import * as winston from "winston";

import { loadResolver } from "./resolver";
export const BATCH_INTERVAL_MS = 100;

const transports = {
    console: new winston.transports.Console({
        stderrLevels: [],
        level: 'info'
    }),
    http: new winston.transports.Http({
        "host": "logs-app.default",
        "ssl": false,
        "path": `/private/v1/logs/orgs/${process.env.WHALY_CONFIG_RESOLVER__ORG_ID}/executions/${process.env.WHALY_CONFIG_RESOLVER__EXECUTION_IDENTIFIER}/logs`,
        "batch": true,
        "batchInterval": BATCH_INTERVAL_MS,
        "batchCount": 10
    })
};

const getTransports = (): winston.transport[] => {
    if (process.env.ENABLE_LOGS_HTTP_EXPORT === "1") {
        return [
            transports.console,
            transports.http
        ]
    }
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