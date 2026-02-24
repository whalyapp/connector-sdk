import type { AssetEntry, ProcessedAsset } from "../asset-tap/types";

export abstract class AssetTarget<C> {
    readonly config: C;

    constructor(config: C) {
        this.config = config;
    }

    abstract shouldSync(entry: AssetEntry): Promise<boolean>;
    abstract uploadAsset(asset: ProcessedAsset): Promise<void>;

    async complete(): Promise<void> {}
}
