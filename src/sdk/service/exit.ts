import { logger } from "./logger";
import { postJSONApiCall } from "./network";
import { loadResolver } from "./resolver";

const closeLogger = async () => {
    if (process.env.ENABLE_LOGS_HTTP_EXPORT === "1") {
        const url = `http://logs-app.default/private/v1/logs/orgs/${process.env.WHALY_CONFIG_RESOLVER__ORG_ID}/executions/${process.env.WHALY_CONFIG_RESOLVER__EXECUTION_IDENTIFIER}/logs/close`;
        return postJSONApiCall(url, {}, {})
    }
}

export async function gracefulExit(exitCode: number) {
    if(exitCode !== 0) {
        await loadResolver().markSyncFailed();
    }
    // Wait for winston to have logged all messages
    // Required as we are using HTTP transport
    const loggerFinish = new Promise<void>((resolve, reject) => {
        logger.closeWinston(resolve)
    })
    await loggerFinish;
    await closeLogger();
    process.exit(exitCode);
}