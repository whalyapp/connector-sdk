import { logger } from "../../sdk/service/logger";
import { CloudStorageService } from "../../services/cloud-storage";
import { StateHolder, StateProvider } from "../../sdk/models/state-provider/types";
import { format } from "util";

export class GCSStateProvider implements StateProvider {
    private bucketName: string;
    private connectorId: string;
    private service: CloudStorageService;

    constructor(connectorId: string, bucketName: string) {
        this.connectorId = connectorId;
        this.bucketName = bucketName;
        this.service = new CloudStorageService(bucketName);
    }

    private getObjectPath(): string {
        return `${this.connectorId}/state.json`;
    }

    async getState(): Promise<StateHolder> {
        const objectPath = this.getObjectPath();
        try {
            logger.info(`📁 Loading state from gs://${this.bucketName}/${objectPath}`);
            const raw = await this.service.readObjectAsString(objectPath);
            const parsed = JSON.parse(raw);
            return { state: parsed };
        } catch (err: any) {
            logger.warn(format(`error loading state from gs://${this.bucketName}/${objectPath}, will start with empty state, err: %s`, err?.message));
            return { state: undefined };
        }
    }

    async writeState(state: string): Promise<void> {
        const objectPath = this.getObjectPath();
        try {
            logger.info(`📝 Writing state to gs://${this.bucketName}/${objectPath}`);
            await this.service.writeStringObject(objectPath, state);
        } catch (err: any) {
            logger.error(format(`💥 Error while writing state to gs://${this.bucketName}/${objectPath}, err: %s`, err?.message));
            throw new Error(format(`error writing state to gs://${this.bucketName}/${objectPath}, err: %s`, err?.message));
        }
    }
}
