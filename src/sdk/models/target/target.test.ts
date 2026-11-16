import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { ITarget } from "./target";
import { StreamState } from "./streamDbState";
import { StreamWarehouseSyncService } from "./dbSync";
import { ReplicationMethod } from "../replication";

const tmpDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map(d => fs.remove(d)));
});

// Records the staging calls made by uploadSingleStreamToWarehouse
function createFakeDbSync() {
    const calls: string[] = [];
    const dbSync = {
        streamId: "test_stream",
        createStagingArea: async () => { calls.push("create"); },
        loadStreamInStagingArea: async (_p: string, opts?: { append?: boolean }) => {
            calls.push(opts?.append ? "load:append" : "load:truncate");
        },
        mergeTempTableWithDestination: async (method: ReplicationMethod) => { calls.push(`merge:${method}`); },
        deleteStagingArea: async () => { calls.push("delete"); },
    };
    return { calls, dbSync: dbSync as unknown as StreamWarehouseSyncService };
}

async function createStreamState(dbSync: StreamWarehouseSyncService, method: ReplicationMethod, rows: number) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "target-test-"));
    tmpDirs.push(tmpDir);
    const state = new StreamState("test_stream", dbSync, method, tmpDir);
    await addRows(state, rows);
    return state;
}

// Write the rows in the local file, as ITarget.record does
async function addRows(state: StreamState, rows: number) {
    for (let i = 0; i < rows; i++) {
        await new Promise<void>((resolve, reject) =>
            state.getFileToLoad().stream.write("{}\n", err => err ? reject(err) : resolve())
        );
        state.incrementBatchedRowCount();
    }
}

describe("ITarget.uploadSingleStreamToWarehouse", () => {
    it("keeps intermediate APPEND batches in the staging table and copies them in one go at commit", async () => {
        const { calls, dbSync } = createFakeDbSync();
        const state = await createStreamState(dbSync, "APPEND", 3);

        await ITarget.uploadSingleStreamToWarehouse(state, { commit: false });
        expect(calls).toEqual(["create", "load:truncate"]);
        expect(state.hasPendingStagedRows()).toBe(true);

        await addRows(state, 2);
        await ITarget.uploadSingleStreamToWarehouse(state, { commit: false });
        expect(calls).toEqual(["create", "load:truncate", "load:append"]);

        await addRows(state, 1);
        await ITarget.uploadSingleStreamToWarehouse(state, { commit: true });
        expect(calls).toEqual(["create", "load:truncate", "load:append", "load:append", "merge:APPEND", "delete"]);
        expect(state.hasPendingStagedRows()).toBe(false);
        expect(state.syncedRowCount).toBe(6);
    });

    it("commits staged APPEND rows even when no row is left in the local file", async () => {
        const { calls, dbSync } = createFakeDbSync();
        const state = await createStreamState(dbSync, "APPEND", 3);

        await ITarget.uploadSingleStreamToWarehouse(state, { commit: false });
        await ITarget.uploadSingleStreamToWarehouse(state, { commit: true });

        expect(calls).toEqual(["create", "load:truncate", "merge:APPEND", "delete"]);
        expect(state.hasPendingStagedRows()).toBe(false);
    });

    it("still merges INCREMENTAL batches at each flush", async () => {
        const { calls, dbSync } = createFakeDbSync();
        const state = await createStreamState(dbSync, "INCREMENTAL", 3);

        await ITarget.uploadSingleStreamToWarehouse(state, { commit: false });

        expect(calls).toEqual(["create", "load:truncate", "merge:INCREMENTAL", "delete"]);
        expect(state.hasPendingStagedRows()).toBe(false);
    });

    it("commits by default", async () => {
        const { calls, dbSync } = createFakeDbSync();
        const state = await createStreamState(dbSync, "APPEND", 1);

        await ITarget.uploadSingleStreamToWarehouse(state);

        expect(calls).toEqual(["create", "load:truncate", "merge:APPEND", "delete"]);
    });
});
