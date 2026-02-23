import fs from "fs-extra";
import { CdnService } from "../../services/cdn";
import { logger } from "../../sdk/service/logger";
import { AssetTarget } from "../../sdk/models/asset-target/asset-target";
import type { AssetEntry, ProcessedAsset } from "../../sdk/models/asset-tap/types";
import type { CdnAssetTargetConfig } from "./models/config";
import { getCdnId } from "../../sdk/service/cdnId";

const logPrefix = "[CdnAssetTarget]";

export class CdnAssetTarget extends AssetTarget<CdnAssetTargetConfig> {
    private readonly cdnService: CdnService;

    constructor(config: CdnAssetTargetConfig) {
        super(config);
        this.cdnService = new CdnService(config);
    }

    async shouldSync(entry: AssetEntry): Promise<boolean> {
        const metadata = await this.cdnService.getFileMetadata(getCdnId(this.config.cdnId), entry.destinationPath);

        if (!metadata.exists) {
            logger.debug(`${logPrefix} ${entry.destinationPath} not in CDN → will sync`);
            return true;
        }

        if (entry.lastModified === undefined) {
            logger.debug(`${logPrefix} ${entry.destinationPath} source has no lastModified → will sync`);
            return true;
        }

        if (metadata.lastModified === null) {
            logger.debug(`${logPrefix} ${entry.destinationPath} CDN has no lastModified → will sync`);
            return true;
        }

        const sourceIsNewer = entry.lastModified > metadata.lastModified;
        if (!sourceIsNewer) {
            logger.debug(`${logPrefix} Skipping ${entry.destinationPath} (CDN is up-to-date)`);
        }
        return sourceIsNewer;
    }

    async uploadAsset(asset: ProcessedAsset): Promise<void> {
        const fileBuffer = await fs.readFile(asset.uploadPath);
        await this.cdnService.uploadFile(
            getCdnId(this.config.cdnId),
            asset.entry.destinationPath,
            fileBuffer
        );
        logger.info(`${logPrefix} Uploaded ${asset.entry.destinationPath} (${fileBuffer.length} bytes)`);
    }
}
