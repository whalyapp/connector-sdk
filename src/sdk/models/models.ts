import { Catalog, CatalogFile, CatalogStream } from "./catalog";
import { ITarget } from "./target/target";

export type ReplicationMethod = "INCREMENTAL" | "FULL_TABLE" | "LOG_BASED";

export type SyncFunction<C> = (target: ITarget, catalogStream: CatalogStream, config: C, catalog: Catalog) => Promise<void>;

export type SourceType = `HUBSPOT`
    | `LAGROWTHMACHINE`
    | `SEGMENT`
    | `COHORT`
    | `AIRTABLE`
    | `AIRTABLE_OAUTH`
    | `BUBBLE`
    | `PIPEDRIVE`
    | `LINKEDIN_ADS`
    | `FACEBOOK_ADS`
    | `SEGMENT`
    | `SALESFORCE`
    | `SALESFORCE_SANDBOX`
    | `RECRUITCRM`
    | `GOOGLE_SHEETS`
    | `GOOGLE_ADS`
    | `GOOGLE_ANALYTICS`
    | `SLACK`
    | `STRIPE`
    | `ORBIT`
    | `GITHUB_STARS`
    | `JAFFLE_SHOP`
    | `POSTGRES`
    | `PENNYLANE`
    | `PENNYLANE_REDSHIFT`
    | `AIRCALL`
    | `AIRCALL_OAUTH`
    | `FAST_POSTGRES_FULL_TABLE`
    | `WOOCOMMERCE`;

export type DestinationType = `GOOGLE_BIGQUERY` |
    `SNOWFLAKE`;

export interface ShoreConfig {
    command: ShoreCommand,
    source: SourceType,
    destination: DestinationType,
    config: any,
    targetConfig: any,
    state?: any,
    catalog?: CatalogFile
}

export type ShoreCommand = "READ" | "DISCOVER";

export type ResolverType = "WHALY" | "LOCAL";