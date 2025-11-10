import { gracefulExit } from "./exit";
import { logger } from "./logger";
import { ErrorType } from "../models/error";

export const haltAndCatchFire = async (
    errorType: ErrorType,
    errorText: string,
    errorDebugText: string
): Promise<void> => {

    logger.error(
        `💥 Got a fatal error that will reported to the end user. Process will stop.
        errorType=%s
        errorText=%s
        errorDebugText=%s
        `,
        errorType,
        errorText,
        errorDebugText
    )
    // we return sucess but we let the sucess job pass the error params
    await gracefulExit(0);
}