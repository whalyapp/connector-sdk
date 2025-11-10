import { StreamId } from "./metadata";
import { StateMessage } from "./messages";
import dayjs, { Dayjs } from "dayjs";
import { ITarget } from "./target/target";
import { defaultDateTimeFormat } from "../constants/date";
import { format } from "util";

export interface InputTapState {
    bookmarks?: {
        [streamId: string]: StreamState
    }
}

export interface TapState {
    bookmarks: {
        [streamId: string]: StreamState
    }
}

export interface Bookmark {
    replicationKey?: string;
    replicationKeyValue?: string; // Contains ISO 8601 string
}

export interface StreamState extends Bookmark {
    progressMarkers?: ProgressMarkers
    replicationKeySignpost?: string
}

export interface ProgressMarkers extends Bookmark {
    Note?: string;
}

// To deprecate
export interface State {
    bookmarks: Bookmarks;
}

// To deprecate
export interface Bookmarks {
    [streamId: string]: any;
}

const PROGRESS_MARKERS = "progressMarkers"
const PROGRESS_MARKER_NOTE = "Note"
const SIGNPOST_MARKER = "replicationKeySignpost"

export const incrementStreamState = (
    state: StreamState,
    replicationKey: string,
    latestRecord: any,
    isSorted: boolean
): StreamState => {

    let newRkValue = latestRecord[replicationKey] as string;
    if (!newRkValue) {
        throw new Error(format(`No value for replicationKey: ${replicationKey} in record with keys: %j`, Object.keys(latestRecord)))
    }
    let newRkValueMoment = dayjs(newRkValue);

    let prevRkValue: string | undefined;
    let prevRkValueMoment: Dayjs | undefined;

    if (isSorted) {
        prevRkValue = state["replicationKeyValue"];
        prevRkValueMoment = dayjs(prevRkValue);
        if (prevRkValue && prevRkValueMoment.isAfter(newRkValueMoment)) {
            throw new Error(
                `Unsorted data detected in stream. Latest value '${newRkValue}' is
                            smaller than previous max '${prevRkValue}'.`
            )
        }
    }

    // For unsorted streams, we have to make sure that the "new" replication key is newer or equal than the previous one
    if (!isSorted) {

        // Progress markers are living only during the current sync
        // They are erased at the end of the sync and the stored value is used to write the new state
        if (!state[PROGRESS_MARKERS]) {
            const marker: ProgressMarkers = {};
            marker[PROGRESS_MARKER_NOTE] = "Progress is not resumable if interrupted."
            state[PROGRESS_MARKERS] = marker;
        }
        prevRkValue = (state[PROGRESS_MARKERS] as any)["replicationKeyValue"];

        // In case we don't have any previous value in the PROGRESS_MARKERS, 
        // which happens for the first record of the current sync, we take the last state value
        prevRkValueMoment = dayjs(prevRkValue || state["replicationKeyValue"]);

        // If we just got an "old" record, we keep the previous state as the max ts
        if (prevRkValue && prevRkValueMoment.isAfter(newRkValueMoment)) {
            newRkValueMoment = prevRkValueMoment;
            newRkValue = prevRkValue;
        }
    }

    // Signpost is the moment we start the current sync,
    // we make sure that our replication value can't be greater than the signpost
    const signpostMarker = state[SIGNPOST_MARKER];
    const replicationKeySignpostMoment = dayjs(signpostMarker);

    if (replicationKeySignpostMoment && replicationKeySignpostMoment.isBefore(newRkValueMoment)) {
        // Overflowed max bookmark threshold, reset to the max for this key:
        newRkValueMoment = replicationKeySignpostMoment
        newRkValue = replicationKeySignpostMoment.format(defaultDateTimeFormat);
    }

    if (isSorted === false) {
        (state[PROGRESS_MARKERS] as ProgressMarkers)['replicationKey'] = replicationKey;
        (state[PROGRESS_MARKERS] as ProgressMarkers)['replicationKeyValue'] = dayjs(newRkValueMoment).format(defaultDateTimeFormat);
    } else {
        state['replicationKey'] = replicationKey;
        state['replicationKeyValue'] = dayjs(newRkValueMoment).format(defaultDateTimeFormat);
    }

    return state;
}

/**
 * Promote or wipe progress markers once sync is complete."""

 * @param state 
 * @returns 
 */
export const finalizeStateProgressMarkers = (state: StreamState): StreamState => {

    const signpostValue = state[SIGNPOST_MARKER];
    const progressMarkers = state[PROGRESS_MARKERS];
    if (progressMarkers && progressMarkers["replicationKey"] && progressMarkers["replicationKeyValue"]) {
        // Replication keys valid (only) after sync is complete
        state["replicationKey"] = progressMarkers["replicationKey"]
        let newRkValue = progressMarkers["replicationKeyValue"]

        // Reset to signpost if needed
        if (signpostValue && _greaterThan(newRkValue, signpostValue)) {
            newRkValue = signpostValue
        }

        const previousReplicationValue = state["replicationKeyValue"];
        if (!previousReplicationValue || (previousReplicationValue && _greaterThan(newRkValue, previousReplicationValue))) {
            state["replicationKeyValue"] = newRkValue
        }
    }
    // Wipe any markers that have not been promoted
    delete state[PROGRESS_MARKERS];

    return state;
}

export const _greaterThan = (aValue: string, bValue: string): boolean => {
    return dayjs(aValue).isAfter(dayjs(bValue));
}

export const extractStateForStream = (state: InputTapState, streamId: StreamId) => {
    if (!state.bookmarks) {
        state.bookmarks = {}
    }
    if (!state.bookmarks[streamId]) {
        state.bookmarks[streamId] = {}
    }
    return state.bookmarks[streamId];
}

export class StateService {

    private static instance: StateService;

    bookmarks: Bookmarks;

    constructor() {
        this.bookmarks = {}
    }

    static getInstance(): StateService {
        if (!this.instance) {
            this.instance = new this();
        }

        return this.instance;
    }

    setBookmark(streamId: StreamId, streamState: StreamState) {
        this.bookmarks[streamId] = streamState;
    }

    setBookmarkSignpost(streamId: StreamId, signpostValue: string) {
        if (!this.bookmarks[streamId]) {
            this.bookmarks[streamId] = {}
        }
        this.bookmarks[streamId][SIGNPOST_MARKER] = signpostValue;
    }

    getBookmark(streamId: StreamId): StreamState {
        if (this.bookmarks[streamId]) {
            return this.bookmarks[streamId];
        } else {
            return {}
        }
    }

    clearState() {
        this.bookmarks = {};
    }

    get(): State {
        const state: State = {
            bookmarks: this.bookmarks
        }
        return state
    }

    async forwardStateToTarget(target: ITarget) {
        const state: State = {
            bookmarks: this.bookmarks
        }

        const message = new StateMessage(state);
        await target.state(message);
    }
}