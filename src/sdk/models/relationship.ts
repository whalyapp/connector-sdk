import { StreamId } from "./catalog";

export interface StreamRelationship {
    left: StreamId
    right: StreamId
    from: string
    to: string
    type: "1-1" | "1-N" | "N-1"
}

export interface DirectionalRelationship {
    type: "1-N" | "N-1" | "1-1"
    streamId: StreamId
    from: string
    to: string
}

export interface DirectionalRelationships { 
    left: DirectionalRelationship[], 
    right: DirectionalRelationship[] 
}