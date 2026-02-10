import { Tap } from "../models/tap/tap";
import { ITarget } from "../models/target/target";
import { StateProvider } from "../models/state-provider/types";
import { FileStreamConfig, FileStreamEntry } from "./types";
import { FileStream } from "./file-stream";

export interface FileTapConfig {
    [key: string]: any;
}

/**
 * FileTap orchestrates multiple FileStreams.
 *
 * It extends Tap so it integrates with the standard Tap -> Stream -> Target flow.
 * Provide file stream entries (config + file path pairs), and it creates a FileStream per entry.
 *
 * For simple sequential file processing without the Tap lifecycle, use processFileStreams() instead.
 */
export class FileTap extends Tap<FileTapConfig> {
    private entries: FileStreamEntry[];

    constructor(
        target: ITarget,
        config: FileTapConfig,
        stateProvider: StateProvider,
        entries: FileStreamEntry[],
    ) {
        super(target, config, stateProvider);
        this.entries = entries;
    }

    /**
     * Convenience constructor for the common case where all configs share the same file path.
     */
    static fromConfigs(
        target: ITarget,
        config: FileTapConfig,
        stateProvider: StateProvider,
        fileConfigs: FileStreamConfig[],
        sharedFilePath: string,
    ): FileTap {
        const entries = fileConfigs.map(c => ({
            config: c,
            filePath: sharedFilePath,
        }));
        return new FileTap(target, config, stateProvider, entries);
    }

    async init(): Promise<void> {
        for (const entry of this.entries) {
            const stream = new FileStream(
                entry.config,
                entry.filePath,
                this.tapState,
                this.target,
            );

            this.streams.push(stream);
        }
    }
}
