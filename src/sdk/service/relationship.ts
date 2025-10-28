import { type StreamId } from "../models/catalog";
import { type DirectionalRelationships, type StreamRelationship } from "../models/relationship";

export const findRelatedRelationships = (
    streamId: StreamId,
    allRels: StreamRelationship[]
): DirectionalRelationships => {

    return allRels.reduce<DirectionalRelationships>((acc, rel) => {
        const base = {
            type: rel.type,
            from: rel.from,
            to: rel.to
        }

        if (rel.left === streamId) {
            acc.right.push({
                streamId: rel.right,
                ...base
            })
        }
        if (rel.right === streamId) {
            acc.left.push({
                streamId: rel.left,
                ...base
            })
        }
        return acc;
    }, { left: [], right: [] })

}