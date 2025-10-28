import { BigQueryConfig } from "../models/config";
import { BigQuery } from "@google-cloud/bigquery";

export class BqClientHolder {
    private static instance: BqClientHolder;

    client: BigQuery;

    constructor(config: BigQueryConfig) {

        const retryOptions = {
            autoRetry: true,
            maxRetries: 3
        }

        this.client = new BigQuery({
            projectId: config.database.trim(),
            ...retryOptions
        });
    }

    static client(config: BigQueryConfig): BigQuery {
        if (!this.instance) {
            this.instance = new this(config);
        }

        return this.instance.client;
    }

}