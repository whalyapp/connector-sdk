import type { CdnServiceConfig } from "../../../services/cdn";

export interface CdnAssetTargetConfig extends CdnServiceConfig {
    /** The CDN ID (organization CDN identifier) */
    cdnId?: string;
}
