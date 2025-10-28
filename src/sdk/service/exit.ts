import { logger } from "./logger";
import { loadResolver } from "./resolver";

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
    process.exit(exitCode);
}