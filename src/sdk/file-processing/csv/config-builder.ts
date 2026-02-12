import { ReplicationMethod } from "../../models/replication";
import {
    CsvFileConfig,
    CsvFieldsConfig,
    CsvFieldsDictConfig,
    CsvFieldsArrayConfig,
    FieldType,
    FileStreamConfig,
} from "../types";
import { createCsvStreamConfig } from "../file-stream";

/**
 * Builder pattern for creating CSV configurations.
 *
 * Usage:
 * ```ts
 * const config = CsvExtractionConfigBuilder.create()
 *   .separator(";")
 *   .encoding("latin1")
 *   .addSyncedAtColumn()
 *   .fieldsFromDict({
 *     "Product ID":   { key: "product_id",   type: "STRING" },
 *     "Product Name": { key: "product_name", type: "STRING" },
 *     "Price":        { key: "price",        type: "FLOAT" },
 *   })
 *   .build();
 * ```
 */
export class CsvExtractionConfigBuilder {
    private _separator: string = ",";
    private _encoding?: string;
    private _addSyncedAtColumn?: boolean;
    private _fields?: CsvFieldsConfig;
    private _fieldsMode?: "dict" | "array";
    private _replicationMethod?: ReplicationMethod;
    private _primaryKeys?: string[];

    static create(): CsvExtractionConfigBuilder {
        return new CsvExtractionConfigBuilder();
    }

    separator(sep: string): CsvExtractionConfigBuilder {
        this._separator = sep;
        return this;
    }

    encoding(enc: string): CsvExtractionConfigBuilder {
        this._encoding = enc;
        return this;
    }

    addSyncedAtColumn(enabled: boolean = true): CsvExtractionConfigBuilder {
        this._addSyncedAtColumn = enabled;
        return this;
    }

    fieldsFromDict(mapping: {
        [header: string]: {
            key: string;
            valueTransformer?: (val: any) => string;
            type: FieldType;
        };
    }): CsvExtractionConfigBuilder {
        if (this._fieldsMode === "array") {
            throw new Error("Cannot use fieldsFromDict after fieldsFromArray");
        }
        this._fieldsMode = "dict";
        this._fields = mapping as CsvFieldsDictConfig;
        return this;
    }

    fieldsFromArray(fields: Array<{
        key: string;
        valueTransformer?: (val: any) => string;
        type: FieldType;
    }>): CsvExtractionConfigBuilder {
        if (this._fieldsMode === "dict") {
            throw new Error("Cannot use fieldsFromArray after fieldsFromDict");
        }
        this._fieldsMode = "array";
        this._fields = fields as CsvFieldsArrayConfig;
        return this;
    }

    replicationMethod(method: ReplicationMethod): CsvExtractionConfigBuilder {
        this._replicationMethod = method;
        return this;
    }

    primaryKeys(keys: string[]): CsvExtractionConfigBuilder {
        this._primaryKeys = keys;
        return this;
    }

    build(): CsvFileConfig {
        if (!this._fields) {
            throw new Error("Fields must be configured (use fieldsFromDict or fieldsFromArray)");
        }

        if (Array.isArray(this._fields) && this._fields.length === 0) {
            throw new Error("Fields must not be empty");
        }

        if (!Array.isArray(this._fields) && Object.keys(this._fields).length === 0) {
            throw new Error("Fields must not be empty");
        }

        const config: CsvFileConfig = {
            separator: this._separator,
            fields: this._fields,
        };

        if (this._encoding !== undefined) {
            config.encoding = this._encoding;
        }

        if (this._addSyncedAtColumn !== undefined) {
            config.addSyncedAtColumn = this._addSyncedAtColumn;
        }

        return config;
    }

    buildStreamConfig(streamId: string): FileStreamConfig {
        const csvConfig = this.build();

        const options: { replicationMethod?: ReplicationMethod; primaryKeys?: string[] } = {};
        if (this._replicationMethod !== undefined) {
            options.replicationMethod = this._replicationMethod;
        }
        if (this._primaryKeys !== undefined) {
            options.primaryKeys = this._primaryKeys;
        }

        return createCsvStreamConfig(streamId, csvConfig, options);
    }
}
