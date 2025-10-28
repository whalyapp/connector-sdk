import { StreamId } from "./catalog";
import { ReplicationMethod } from "./models";

export type InclusionMode = "available" | "automatic" | "unsupported";

export interface MetadataEntry {
    /// From Singer Spec ///
    // ---------------------------------------------------------------------------------------
    //  Non discoverable - Can't be written by the tap itself during discovery mode
    // Another system (ex. UI, Human being) should set those between the discovery and the sync
    // ---------------------------------------------------------------------------------------
    selected?: boolean,
    "replication-method"?: ReplicationMethod,
    "replication-key"?: string,
    "view-key-properties"?: string[], // Only for database tap

    // ---------------------------------------------------------------------------------------
    // Discovereable - The tap should write those when possible
    // ---------------------------------------------------------------------------------------
    "inclusion"?: InclusionMode,
    "selected-by-default"?: boolean,
    // Keys that will be presented to the end user to select the proper replication key
    "valid-replication-keys"?: string[],

    // Force the replication mecanism when set, end user can't control it anymore afterwards
    "forced-replication-method"?: ReplicationMethod,
    "forced-replication-key"?: string,

    "table-key-properties"?: string[],
    "schema-name"?: string, // Only for database tap
    "is-view"?: boolean, // Only for database tap
    "row-count"?: number, // Only for database tap
    "database-name"?: string, // Only for database tap
    "sql-datatype"?: string // Only for database tap

    /// Whaly extensions ///
    "whaly-display-label"?: string,
    "whaly-description"?: string,
    "whaly-parent-stream"?: StreamId
}

export interface CatalogMetadata {
    breadcrumb: string[],
    metadata: MetadataEntry
}

// The default javascript Map is working with references when getting/setting when using arrays as keys
// However, in our code we don't keep track of the arrays references, we want to work only with the arrays values
// Hence we have to use a version that compares the values of the arrays when doing set/get
class MetadataMap extends Map<string[], MetadataEntry>{
    private areEquals(array1: string[], array2: string[]): boolean {
        return array1.length === array2.length
            && array1.every(function (value, index) { return value === array2[index] })
    }
    private findExistingEntry(key: string[]): [string[], MetadataEntry] | undefined {
        return Array.from(super.entries()).find(entry => {
            if (this.areEquals(entry[0], key)) {
                return true;
            }
        })
    }
    get(key: string[]) {
        const existingEntry = this.findExistingEntry(key);
        return existingEntry?.[1];
    }
    set(key: string[], value: MetadataEntry) {
        const existingKey = this.findExistingEntry(key);
        if (existingKey) {
            return super.set(existingKey?.[0], value);
        } else {
            return super.set(key, value);
        }
    }
}

export class StreamMetadata {

    metadataByBreadcrumb: MetadataMap;

    constructor() {
        this.metadataByBreadcrumb = new MetadataMap();
    }

    fromCatalogStreamMetadata(metadataArr: CatalogMetadata[]) {
        metadataArr.forEach(metadata => {
            this.metadataByBreadcrumb.set(metadata.breadcrumb, metadata.metadata);
        })
        return this;
    }

    toString() {
        return this.metadataByBreadcrumb;
    }

    get(breadcrumb: string[]) {
        return this.metadataByBreadcrumb.get(breadcrumb);
    }

    write(breadcrumb: string[], key: string, value: any) {

        if (value === undefined) {
            throw new Error(`The value you're trying to write on the metadata at breadcrumb: \`${breadcrumb}\` and key: \`${key}\` is undefined.
            
            Writing an undefined value is not a valid operation. Is there something wrong with your value?`)
        }

        if (!this.metadataByBreadcrumb.get(breadcrumb)) {
            this.metadataByBreadcrumb.set(breadcrumb, {})
        }

        const previousValue = this.metadataByBreadcrumb.get(breadcrumb);
        const newValue: any = {};
        newValue[key] = value;

        this.metadataByBreadcrumb.set(breadcrumb, { ...previousValue, ...newValue });

        return this;
    }

    private getRootBreadcrumbMetadata(): MetadataEntry {
        const rootBreadcrumbMetadata = this.metadataByBreadcrumb.get([]);

        if (!rootBreadcrumbMetadata) {
            throw new Error(`No metadata was attached to the root breadcrumb \`[\`] while we need one to store metadata at the table level. 
            
            Is your catalog properly generated?`)
        }

        return rootBreadcrumbMetadata;
    }

    isStreamSelected(): boolean {
        const rootBreadcrumbMetadata = this.getRootBreadcrumbMetadata();

        if (rootBreadcrumbMetadata.selected === false) {
            return false;
        }

        if (
            rootBreadcrumbMetadata.selected === true
            || rootBreadcrumbMetadata["selected-by-default"] === true
        ) {
            return true;
        }

        return false;
    }

    getKeyProperties(): string[] {
        const rootBreadcrumbMetadata = this.getRootBreadcrumbMetadata();

        if (!rootBreadcrumbMetadata["table-key-properties"]) {
            return []
        }

        return rootBreadcrumbMetadata["table-key-properties"];
    }

    getReplicationKey(): string | undefined {
        const rootBreadcrumbMetadata = this.getRootBreadcrumbMetadata();

        if (!rootBreadcrumbMetadata["replication-key"]) {
            return undefined
        }

        return rootBreadcrumbMetadata["replication-key"];
    }

    getReplicationMethod(): ReplicationMethod | undefined {
        const rootBreadcrumbMetadata = this.getRootBreadcrumbMetadata();

        if (!rootBreadcrumbMetadata["replication-method"]) {
            return undefined
        }

        return rootBreadcrumbMetadata["replication-method"];
    }

    getForcedReplicationMethod(): ReplicationMethod | undefined {
        const rootBreadcrumbMetadata = this.getRootBreadcrumbMetadata();

        if (!rootBreadcrumbMetadata["forced-replication-method"]) {
            return undefined
        }

        return rootBreadcrumbMetadata["forced-replication-method"];
    }

    toList(): CatalogMetadata[] {
        return Array.from(this.metadataByBreadcrumb.keys()).map(breadcrumb => {
            const metadata = this.metadataByBreadcrumb.get(breadcrumb);

            if (!metadata) {
                throw new Error(`There was no metadata entry for breadcrumb: \`${breadcrumb}\` in metadata map: ${this.metadataByBreadcrumb.toString()}`)
            }

            return {
                breadcrumb,
                metadata: metadata
            }
        })
    }

}