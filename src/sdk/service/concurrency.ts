/**
 * Run an array of async task factories with a bounded concurrency limit.
 * Results are returned in the same order as the input tasks.
 */
export async function runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
): Promise<T[]> {
    if (concurrency < 1) {
        throw new Error(`concurrency must be >= 1, got ${concurrency}`);
    }

    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            const task = tasks[index];
            if (task) {
                results[index] = await task();
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, tasks.length) },
        () => worker(),
    );
    await Promise.all(workers);

    return results;
}

/**
 * Process items from an async iterable with bounded concurrency.
 *
 * Spawns `concurrency` workers that each pull from the shared iterator.
 * - If `processor` returns `"stop"`, no new items are pulled (in-flight items finish).
 * - If `processor` throws and no `onError` is provided, the error propagates and stops all workers.
 * - If `onError` is provided, errors are swallowed (handled by callback) and processing continues.
 */
export async function processFromAsyncIterable<T>(
    iterable: AsyncIterable<T>,
    processor: (item: T) => Promise<void | "continue" | "stop">,
    concurrency: number,
    onError?: (item: T, error: unknown) => void,
): Promise<void> {
    if (concurrency < 1) {
        throw new Error(`concurrency must be >= 1, got ${concurrency}`);
    }

    const iterator = iterable[Symbol.asyncIterator]();
    let stopped = false;

    async function worker(): Promise<void> {
        while (!stopped) {
            const { value, done } = await iterator.next();
            if (done) break;

            try {
                const result = await processor(value);
                if (result === "stop") {
                    stopped = true;
                    break;
                }
            } catch (err) {
                if (onError) {
                    onError(value, err);
                } else {
                    stopped = true;
                    throw err;
                }
            }
        }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
}
