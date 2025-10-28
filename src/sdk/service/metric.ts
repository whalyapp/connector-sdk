const metricStore: {
    [streamId: string]: {
        [metricName: string]: CounterMetric
    }
} = {};

export const ALL_STREAM_ID_KEYWORD = "all";
export const ROWS_SYNCED_METRIC_NAME = "rows_synced_count";
export const API_CALLS_METRIC_NAME = "api_calls_count";
export const EXECUTION_TIME_METRIC_NAME = "execution_time_ms";

// We're using functions here so that the call is done lazily
// when the stream is initialized and the proper isSilent + streamId is configured
// otherwise we have the default streamId value here
export interface MetricConfiguration {
    isEnabled: () => boolean;
    getStreamIds?: () => string[];
}

export const getCounterMetrics = (
    name: string,
    streamIds: string[]
): CounterMetric[] => {
    return streamIds.map(streamId => {
        return getCounterMetric(name, streamId)
    })
}

export const getCounterMetric = (
    name: string,
    streamId: string = ALL_STREAM_ID_KEYWORD
): CounterMetric => {
    if (!metricStore[streamId]) {
        metricStore[streamId] = {};
    }
    const streamMetricStore = metricStore[streamId];

    if (!streamMetricStore[name]) {
        streamMetricStore[name] = new CounterMetric(name, streamId);
    }
    return streamMetricStore[name];
}

export const getAllMetrics = (): CounterMetric[] => {
    return Object.keys(metricStore)
        .flatMap(streamId => {
            const streamMetricStore = metricStore[streamId];
            if (!streamMetricStore) {
                return [] as CounterMetric[];
            }
            return Object.keys(streamMetricStore)
                .map(metricName => streamMetricStore[metricName])
                .filter((m): m is CounterMetric => m !== undefined)
        })
}

export class CounterMetric {
    private value: number = 0;
    name: string;
    streamId: string;

    constructor(
        name: string,
        streamId: string
    ) {
        this.name = name;
        this.streamId = streamId;
    }

    increment(inc: number = 1): void {
        this.value = this.value + inc;
    }

    getStreamId(): string {
        return this.streamId
    }

    getName(): string {
        return this.name
    }

    getValue(): number {
        return this.value
    }
}