export type ReplicationMethod = "INCREMENTAL" | "FULL_TABLE";

export type DestinationType = `GOOGLE_BIGQUERY` |
    `SNOWFLAKE`;

export interface StateHolder {
    state?: any
}