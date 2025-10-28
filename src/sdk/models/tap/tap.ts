import { logger } from "../../service/logger";
import { CatalogFile, Catalog } from "../catalog";
import { CatalogMetadata, StreamMetadata } from "../metadata";
import { StateService } from "../state";
import { ITarget } from "../target/target";
import { StreamV2 } from "./stream";
import { Promise as BPromise } from "bluebird";
import { DepGraph } from "dependency-graph";

export const DEFAULT_MAX_CONCURRENT_STREAMS = 5;

export abstract class Tap<C> {
    _target: ITarget;
    _config: C;
    _streams: StreamV2[];
    _concurrency: number = DEFAULT_MAX_CONCURRENT_STREAMS;

    abstract init(): Promise<void>;
    abstract requiredConfigKeys(): string[];

    constructor(
        target: ITarget,
        config: C
    ) {
        this._streams = [];
        this._target = target;
        this._config = config
    }

    discover = async (
        existingCatalog: CatalogFile | undefined
    ): Promise<CatalogFile> => {

        logger.debug('Loading schemas');

        const streamDepGraph = new DepGraph<StreamV2<any, any, any>>();

        const buildDependencyGraph = (
            streams: StreamV2<any, any, any>[],
            parentId?: string
        ): void => {
            streams.forEach(s => {
                streamDepGraph.addNode(s.streamId, s);
                if (parentId) {
                    streamDepGraph.addDependency(s.streamId, parentId)
                }
                if (s.children) {
                    return buildDependencyGraph(s.children, s.streamId);
                }
            })
        }

        buildDependencyGraph(this._streams);

        const discoveredStreamCatalogEntries = await BPromise.map(
            streamDepGraph.overallOrder(),
            async streamId => {
                logger.info(`✨ Loading schema for ${streamId}`)
                const stream = streamDepGraph.getNodeData(streamId);
                const schema = await stream.getSchema();
                const parentStreamIds = streamDepGraph.directDependenciesOf(streamId);
                if (parentStreamIds.length > 1) {
                    throw new Error(`StreamId=${streamId} directly depends on more than 1 stream, e.g. ${parentStreamIds.join(",")} which is not supported!`)
                }
                const parentStreamId = parentStreamIds?.[0];
                const { metadata } = await this.generateMetadataFromStream(stream, parentStreamId);
                return {
                    schema,
                    metadata,
                    stream: stream.streamId,
                    tap_stream_id: stream.streamId,
                }
            },
            { concurrency: this._concurrency }
        );

        // We want to keep the catalog configuration of already discovered streams to keep end user configuration
        // So we detect newly discovered streams and we only append those to the catalog
        const existingCatalogStreamIds = (existingCatalog?.streams || []).map(entry => {
            return entry.stream;
        });

        const newlyDiscoveredStreamCatalogEntries = discoveredStreamCatalogEntries
            .filter((entry) => {
                if (existingCatalogStreamIds.includes(entry.stream)) {
                    return false;
                } else {
                    return true;
                }
            })

        logger.debug(`Newly discovered streams: %j`, newlyDiscoveredStreamCatalogEntries);

        const allDiscoveredStreamIds = discoveredStreamCatalogEntries
            .map(entry => {
                return entry.stream
            })

        const existingCatalogMinusDeletedStreams = (existingCatalog?.streams || [])
            .filter(entry => {
                if (!allDiscoveredStreamIds.includes(entry.stream)) {
                    logger.debug(`Stream %s was deleted, removing it from the catalog`, entry.stream)
                    return false
                } else {
                    return true;
                }
            })

        // This is used to make some updates on the existing catalog entries by overriding the values with the ones from the current discovery result
        // This is currently used:
        // - to override the parent stream value in case of a streamId change in the connector code
        // - to update the rowCount value on streams which is dynamic
        // - to update the forced replication config in case of a change in the connector code
        // - to publish the valid replication keys in case of a change in the connector code
        const updatedExistingCatalog = existingCatalogMinusDeletedStreams
            .map(existingCatalogEntry => {
                const matchingDiscoveredCatalogEntry = discoveredStreamCatalogEntries.find(entry => entry.stream === existingCatalogEntry.stream)
                if (matchingDiscoveredCatalogEntry) {
                    const existingRootMetadata = existingCatalogEntry.metadata.find(metadata => metadata.breadcrumb.length === 0);
                    const discoveredRootMetadata = matchingDiscoveredCatalogEntry.metadata.find(metadata => metadata.breadcrumb.length === 0);
                    if (existingRootMetadata) {
                        // As `existingRootMetadata` is a reference to the proper item of the array, this will have a side effect on existingCatalogEntry
                        const parentStreamVal = discoveredRootMetadata?.metadata["whaly-parent-stream"];
                        if (parentStreamVal !== undefined) {
                            existingRootMetadata.metadata["whaly-parent-stream"] = parentStreamVal;
                        }
                        const forcedReplicationMethodVal = discoveredRootMetadata?.metadata["forced-replication-method"];
                        if (forcedReplicationMethodVal !== undefined) {
                            existingRootMetadata.metadata["forced-replication-method"] = forcedReplicationMethodVal;
                        }
                        const forcedReplicationKeyVal = discoveredRootMetadata?.metadata["forced-replication-key"];
                        if (forcedReplicationKeyVal !== undefined) {
                            existingRootMetadata.metadata["forced-replication-key"] = forcedReplicationKeyVal;
                        }
                        const validReplicationKeysVal = discoveredRootMetadata?.metadata["valid-replication-keys"];
                        if (validReplicationKeysVal !== undefined) {
                            existingRootMetadata.metadata["valid-replication-keys"] = validReplicationKeysVal;
                        }
                        const rowCountVal = discoveredRootMetadata?.metadata["row-count"];
                        if (rowCountVal !== undefined) {
                            existingRootMetadata.metadata["row-count"] = rowCountVal;
                        }
                    }
                }
                return existingCatalogEntry
            })

        const streams = updatedExistingCatalog.concat(newlyDiscoveredStreamCatalogEntries)
        return { streams };
    }

    sync = async (catalog: Catalog): Promise<void> => {
        await this.initiateSync(catalog);
        logger.debug(`[TAP] All streams have finished syncing. We send the [complete] signal to the target.`)
        await this._target.complete();
        return Promise.resolve();
    };

    async generateMetadataFromStream(
        stream: StreamV2,
        parentStreamId: string | undefined
    ): Promise<{ metadata: CatalogMetadata[]; }> {
        const metadata = new StreamMetadata();

        metadata.write([], "table-key-properties", stream.primaryKey);
        const defaultReplicationConfig = stream.defaultReplicationConfig();

        // Default value for catalog generation, will be overriden by end user in the interface if needed
        metadata.write([], "replication-method", defaultReplicationConfig.replicationMethod);

        const validReplicationkeys = await stream.getValidReplicationKeys();
        metadata.write([], "valid-replication-keys", validReplicationkeys);

        if (defaultReplicationConfig.isForced) {
            metadata.write([], "forced-replication-method", defaultReplicationConfig.replicationMethod);
            if (stream.forcedReplicationKey) {
                metadata.write([], "forced-replication-key", stream.forcedReplicationKey);
            }
        }

        const rowCount = await stream.getRowCount();
        if (rowCount !== undefined) {
            metadata.write([], "row-count", rowCount);
        }

        // We hide from the UI the silent streams that are technical
        if (stream.isSilent === true) {
            metadata.write([], "whaly-is-hidden", stream.isSilent);
        }

        // We only select by default the non silent stream, as those will be the only ones to be configurable in the UI
        if (stream.isSilent === false) {
            metadata.write([], "selected-by-default", stream.selectedByDefault);
        }

        if (stream.displayLabel) {
            metadata.write([], "whaly-display-label", stream.displayLabel);
        }

        if (stream.description) {
            metadata.write([], "whaly-description", stream.description);
        }

        if (parentStreamId !== undefined) {
            metadata.write([], "whaly-parent-stream", parentStreamId);
        }

        return { metadata: metadata.toList() }
    }

    async initiateSync(catalog: Catalog) {

        logger.info(`🚀 Start syncing`)

        const state = StateService.getInstance().get();

        logger.info(`📍 Received state: %j`, state)
        logger.debug(`📚 Received catalog: %j`, catalog)

        const selectedStreams = catalog.getSelectedStreams();

        if (selectedStreams.length === 0) {
            logger.info(`😱 There is no stream to sync. 
            
            Did you update the \`catalog.json\` to add \`"selected": true\` in the table metadata associated with the root breadcrumb (e.g. \`[]\`)`);
            return
        }

        const selectedStreamIds = selectedStreams.map(stream => stream.stream);
        logger.info(`🥳 Syncing selected streams: %s`, selectedStreamIds.join(","))

        await BPromise.map(this._streams, (stream) => {
            if (selectedStreamIds.includes(stream.streamId)) {
                const selectedStream = selectedStreams.find((selectedStream => selectedStream.stream === stream.streamId))
                const rootMetadataEntry = selectedStream?.metadata.find(streamMdt => streamMdt.breadcrumb.length === 0);
                if (!rootMetadataEntry) {
                    throw new Error(`Can't find a catalog root metadata entry for StreamId=${stream.streamId}`)
                }
                stream.setRootMetadataEntry(rootMetadataEntry.metadata);
                return stream.sync();
            }
        },
            {
                concurrency: this._concurrency
            });

    }

    // Used to clean up any ressource before exit
    end(): Promise<void> {
        return Promise.resolve()
    }
}