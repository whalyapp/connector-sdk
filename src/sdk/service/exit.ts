import { logger } from "./logger";

export async function gracefulExit(exitCode: number) {
    // Wait for winston to have logged all messages
    // Required as we are using HTTP transport
    const loggerFinish = new Promise<void>((resolve, reject) => {
        logger.closeWinston(resolve)
    })
    await loggerFinish;
    process.exit(exitCode);
}