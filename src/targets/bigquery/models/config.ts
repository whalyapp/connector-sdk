import { BaseConfig } from "../../../sdk/models/target/models";

export interface BigQueryConfig extends BaseConfig {
    schema: string;
    project_id: string;
    loading_deck_gcs_bucket_name: string;
    location?: BigqueryLocation
}

export type BigqueryLocation = "US" | "EU";