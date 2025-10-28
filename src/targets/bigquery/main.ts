import { ITarget } from "../../sdk/models/target/target"
import { BigQueryConfig } from "./models/config";

import { safeColumnName, safeTableName } from "./helpers";
import { Resolver } from "../../sdk/models/resolver";
import { convertNumberIntoDecimal, validateDateRange } from "./service/record";
import { BigQueryDBSync } from "./service/dbSync";
import { StreamId } from "../../sdk/models/catalog";

export class BigQueryTarget extends ITarget<BigQueryConfig> {

    constructor(config: BigQueryConfig, resolver: Resolver) {
        super(config, resolver);
        this.renameColumnStore.setSafeColumnNameConverter(this.safeColumnNameConverter);
    }
    static requiredConfigKeys = [
        "schema",
        "project_id",
        "loading_deck_gcs_bucket_name"
    ]

    newDBSyncInstance = (
        streamId: StreamId,
        database: string,
        schema: string,
        table: string,
    ): BigQueryDBSync => {
        return new BigQueryDBSync(
            this.config,
            streamId,
            database,
            schema,
            table,
            this.renameColumnStore
        )
    };

    genTableName = safeTableName;
    safeColumnNameConverter = safeColumnName;
    validateDateRange = validateDateRange;
    convertNumberIntoDecimal = convertNumberIntoDecimal;

}