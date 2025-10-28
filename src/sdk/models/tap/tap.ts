import { logger } from "../../service/logger";
import { StateService } from "../state";
import { ITarget } from "../target/target";
import { Stream } from "./stream";
import Bluebird from "bluebird";

export const DEFAULT_MAX_CONCURRENT_STREAMS = 5;

export type SyncOptions = { include?: string[]; exclude?: string[] };

export abstract class Tap<C> {
    target: ITarget;
    config: C;
    streams: Stream[];
    concurrency: number = DEFAULT_MAX_CONCURRENT_STREAMS;

    abstract init(): Promise<void>;

    constructor(
        target: ITarget,
        config: C
    ) {
        this.streams = [];
        this.target = target;
        this.config = config
    }
    sync = async (options?: SyncOptions): Promise<void> => {

        logger.info(`🚀 Start syncing`)

        const state = StateService.getInstance().get();
        logger.info(`📍 Received state: %j`, state)

        const envInclude = process.env.TAP_STREAMS
            ? process.env.TAP_STREAMS.split(',').map(s => s.trim()).filter(s => s.length > 0)
            : undefined;

        const include = options?.include && options.include.length > 0
            ? options.include
            : envInclude;
        const exclude = new Set((options?.exclude || []).map(s => s.trim()))

        let streamsToRun = this.streams.filter(s => !s.isSilent);
        if (include && include.length > 0) {
            const includeSet = new Set(include);
            streamsToRun = streamsToRun.filter(s => includeSet.has(s.streamId));
        }
        if (exclude.size > 0) {
            streamsToRun = streamsToRun.filter(s => !exclude.has(s.streamId));
        }

        const selectedStreamIds = streamsToRun.map(s => s.streamId);
        logger.info(`🥳 Syncing streams: %s`, selectedStreamIds.join(","))

        await Bluebird.map(streamsToRun, (stream) => {
            return stream.sync();
        }, { concurrency: this.concurrency });

        logger.debug(`[TAP] All streams have finished syncing. We send the [complete] signal to the target.`)
        await this.target.complete();
        return Promise.resolve();
    };

    // Used to clean up any ressource before exit
    end(): Promise<void> {
        return Promise.resolve()
    }
}