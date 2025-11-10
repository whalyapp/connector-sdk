export class BatchSingletonHolder<T = unknown> {

        private static instance: {[key: string]: Batch<unknown>};

        constructor() {}

        static getInstance(key: string, maxBatchSize: number): Batch<unknown> {
            const id = `${key}-${maxBatchSize}`

            if(!this.instance) {
                this.instance = {}
            }

            if (!this.instance[id]) {
                this.instance[id] = new Batch(maxBatchSize);
            }

            return this.instance[id];
        }
}

export class Batch<T> {
    data: any[];
    maxBatchSize: number;

    constructor(maxBatchSize: number) {
        this.maxBatchSize = maxBatchSize;
        this.data = [];
    }

    push(data: T) {
        this.data.push(data)
    }

    get(options?: {flush: boolean}): T[] {
        if((options && options.flush) || this.data.length >= this.maxBatchSize) {
            const returnedData = this.data.slice(0);
            this.data = [];
            return returnedData;
        }

        return [];
    }
}