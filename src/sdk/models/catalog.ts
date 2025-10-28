import { CatalogMetadata as CatalogStreamMetadata, StreamMetadata } from "./metadata";
import { loadJson } from "../utils";
import { logger } from "../service/logger";
import * as _ from "lodash";

export type StreamId = string;
export type StreamName = string;

export interface CatalogStream {
    tap_stream_id: StreamId;
    stream: StreamName;
    schema: any;
    metadata: CatalogStreamMetadata[];
}

export interface CatalogFile {
    streams: CatalogStream[]
}

export class Catalog {

    streams?: CatalogStream[];

    static fromFile(fileName: string) {
        const catalogFile: CatalogFile = loadJson(fileName);

        const catalog = new Catalog();
        catalog.streams = catalogFile.streams;
        return catalog;
    }

    static fromCatalogFile(catalogFile: CatalogFile) {
        const catalog = new Catalog();
        catalog.streams = catalogFile.streams;
        return catalog;
    }

    getSelectedStreams(): CatalogStream[] {

        if (!this.streams) {
            return [];
        }

        const directSelectedStreams = this.streams.filter(stream => {
            const metadata = new StreamMetadata();
            metadata.fromCatalogStreamMetadata(stream.metadata)
            return metadata.isStreamSelected();
        });

        logger.debug(`Directly selected streams: ${directSelectedStreams.map((stream) => stream.stream).join(",")}`)

        const getIndirectSelectedStreams = (
            stream: CatalogStream,
            ancestorsIds?: string[]
        ): string[] => {
            const currAncestorsIds = ancestorsIds || [];

            const rootBreadcrumbMetadata = stream.metadata.find((metadata) => metadata.breadcrumb.length === 0);

            const parentStreamId = rootBreadcrumbMetadata?.metadata?.["whaly-parent-stream"];
            if (parentStreamId) {
                const parentStream = this.streams?.find(stream => stream.stream === parentStreamId);
                if (parentStream) {
                    currAncestorsIds.push(parentStreamId);
                    return getIndirectSelectedStreams(parentStream, currAncestorsIds)
                }
            }

            // Final point of the recursion
            return currAncestorsIds;
        }

        const indirectSelectedStreamIds = _.uniq(
            directSelectedStreams.
            flatMap((stream) => {
                return getIndirectSelectedStreams(stream);
            })
        )

        logger.debug(`Indirectly selected streams: ${indirectSelectedStreamIds.join(",")}`)

        // Todo: handle duplicated with directly selected streams
        const indirectSelectedStreams = indirectSelectedStreamIds
            .map((streamId) => {
                // In order to avoid selecting twice the same streams,
                // we check if it wasn't already directly selected
                if (!directSelectedStreams.find(stream => stream.stream === streamId)) {
                    return this.streams?.find((stream) => stream.stream === streamId)
                }
            })
            .filter((stream): stream is CatalogStream => !!stream)

        return directSelectedStreams.concat(indirectSelectedStreams);
    }

}