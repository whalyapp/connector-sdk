import { describe, it, expect } from "vitest";
import { processFromAsyncIterable } from "./concurrency";

async function* generate<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) yield item;
}

describe("processFromAsyncIterable", () => {
    it("processes all items from the iterable", async () => {
        const processed: number[] = [];
        await processFromAsyncIterable(
            generate([1, 2, 3, 4, 5]),
            async (item) => { processed.push(item); },
            3,
        );
        expect(processed.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it("respects concurrency limit", async () => {
        let active = 0;
        let maxActive = 0;
        await processFromAsyncIterable(
            generate([1, 2, 3, 4, 5, 6]),
            async (_item) => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise(r => setTimeout(r, 50));
                active--;
            },
            2,
        );
        expect(maxActive).toBe(2);
    });

    it("handles empty iterable", async () => {
        const processed: number[] = [];
        await processFromAsyncIterable(
            generate([]),
            async (item) => { processed.push(item); },
            3,
        );
        expect(processed).toEqual([]);
    });

    it("propagates errors from the processor", async () => {
        await expect(
            processFromAsyncIterable(
                generate([1, 2, 3]),
                async (item) => { if (item === 2) throw new Error("boom"); },
                1,
            ),
        ).rejects.toThrow("boom");
    });

    it("collects errors when onError handler is provided", async () => {
        const errors: Array<{ item: number; error: Error }> = [];
        await processFromAsyncIterable(
            generate([1, 2, 3]),
            async (item) => { if (item === 2) throw new Error("boom"); },
            1,
            (item, err) => { errors.push({ item, error: err as Error }); },
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]!.item).toBe(2);
        expect(errors[0]!.error.message).toBe("boom");
    });

    it("supports early stop via return value", async () => {
        const processed: number[] = [];
        await processFromAsyncIterable(
            generate([1, 2, 3, 4, 5]),
            async (item) => {
                processed.push(item);
                return item >= 3 ? "stop" : "continue";
            },
            1,
        );
        expect(processed).toEqual([1, 2, 3]);
    });

    it("throws if concurrency < 1", async () => {
        await expect(
            processFromAsyncIterable(generate([1]), async () => {}, 0),
        ).rejects.toThrow("concurrency must be >= 1");
    });
});
