// Minimal type exports only; runtime Catalog is deprecated/removed.
export type StreamId = string;
export type StreamName = string;

export interface CatalogStreamMetadata {
    breadcrumb: string[];
    metadata: Record<string, any>;
}

export interface CatalogStream {
    tap_stream_id: StreamId;
    stream: StreamName;
    schema: any;
    metadata: CatalogStreamMetadata[];
}

export interface CatalogFile {
    streams: CatalogStream[]
}