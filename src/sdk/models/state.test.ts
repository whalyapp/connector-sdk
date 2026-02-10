import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import {
  incrementStreamState,
  finalizeStateProgressMarkers,
  _greaterThan,
  extractStateForStream,
  StreamState,
  InputTapState,
} from "./state";
import { defaultDateTimeFormat } from "../constants/date";

const fmt = (d: string) => dayjs(d).format(defaultDateTimeFormat);

describe("_greaterThan", () => {
  it("returns true when first date is after second", () => {
    expect(_greaterThan("2024-02-01", "2024-01-01")).toBe(true);
  });

  it("returns false when first date is before second", () => {
    expect(_greaterThan("2024-01-01", "2024-02-01")).toBe(false);
  });

  it("returns false when dates are equal", () => {
    expect(_greaterThan("2024-01-01", "2024-01-01")).toBe(false);
  });
});

describe("extractStateForStream", () => {
  it("creates bookmarks object when missing", () => {
    const state: InputTapState = {};
    const result = extractStateForStream(state, "stream1");
    expect(state.bookmarks).toBeDefined();
    expect(result).toEqual({});
  });

  it("creates stream entry when missing", () => {
    const state: InputTapState = { bookmarks: {} };
    extractStateForStream(state, "stream1");
    expect(state.bookmarks!["stream1"]).toEqual({});
  });

  it("returns existing stream state", () => {
    const existing: StreamState = {
      replicationKey: "updated_at",
      replicationKeyValue: "2024-01-01",
    };
    const state: InputTapState = { bookmarks: { stream1: existing } };
    const result = extractStateForStream(state, "stream1");
    expect(result).toBe(existing);
  });
});

describe("incrementStreamState", () => {
  const RK = "updated_at";

  describe("sorted stream", () => {
    it("advances replication key value", () => {
      const state: StreamState = {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-01-01"),
      };
      const record = { [RK]: "2024-02-01T00:00:00Z" };
      const result = incrementStreamState(state, RK, record, true);
      expect(dayjs(result.replicationKeyValue).isAfter("2024-01-31")).toBe(true);
    });

    it("throws on out-of-order data", () => {
      const state: StreamState = {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-06-01"),
      };
      const record = { [RK]: "2024-01-01T00:00:00Z" };
      expect(() => incrementStreamState(state, RK, record, true)).toThrow(
        /Unsorted data detected/
      );
    });

    it("caps at signpost", () => {
      const signpost = "2024-03-01T00:00:00Z";
      const state: StreamState = {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-01-01"),
        replicationKeySignpost: fmt(signpost),
      };
      const record = { [RK]: "2024-06-01T00:00:00Z" };
      const result = incrementStreamState(state, RK, record, true);
      // Should be capped to the signpost value
      expect(
        dayjs(result.replicationKeyValue).isAfter(dayjs(signpost).add(1, "second"))
      ).toBe(false);
    });
  });

  describe("unsorted stream", () => {
    it("tracks max via progress markers", () => {
      const state: StreamState = {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-01-01"),
      };
      // First record
      incrementStreamState(state, RK, { [RK]: "2024-03-01T00:00:00Z" }, false);
      // Second record with earlier date — should keep the max
      incrementStreamState(state, RK, { [RK]: "2024-02-01T00:00:00Z" }, false);

      expect(state.progressMarkers).toBeDefined();
      expect(
        dayjs(state.progressMarkers!.replicationKeyValue).isAfter("2024-02-28")
      ).toBe(true);
    });

    it("creates progress markers with a Note", () => {
      const state: StreamState = {};
      incrementStreamState(state, RK, { [RK]: "2024-01-01T00:00:00Z" }, false);
      expect(state.progressMarkers?.Note).toContain("not resumable");
    });

    it("caps at signpost", () => {
      const signpost = "2024-02-01T00:00:00Z";
      const state: StreamState = {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-01-01"),
        replicationKeySignpost: fmt(signpost),
      };
      incrementStreamState(state, RK, { [RK]: "2024-06-01T00:00:00Z" }, false);
      expect(
        dayjs(state.progressMarkers!.replicationKeyValue).isAfter(
          dayjs(signpost).add(1, "second")
        )
      ).toBe(false);
    });
  });

  it("throws when replication key is missing from record", () => {
    const state: StreamState = {};
    expect(() => incrementStreamState(state, RK, { foo: "bar" }, true)).toThrow(
      /No value for replicationKey/
    );
  });
});

describe("finalizeStateProgressMarkers", () => {
  const RK = "updated_at";

  it("promotes progress markers to top-level", () => {
    const state: StreamState = {
      replicationKey: RK,
      replicationKeyValue: fmt("2024-01-01"),
      progressMarkers: {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-03-01"),
      },
    };
    const result = finalizeStateProgressMarkers(state);
    expect(dayjs(result.replicationKeyValue).isAfter("2024-02-28")).toBe(true);
    expect(result.progressMarkers).toBeUndefined();
  });

  it("wipes progress markers even if no keys present", () => {
    const state: StreamState = {
      progressMarkers: {
        Note: "Progress is not resumable if interrupted.",
      },
    };
    const result = finalizeStateProgressMarkers(state);
    expect(result.progressMarkers).toBeUndefined();
  });

  it("caps promoted value at signpost", () => {
    const signpost = fmt("2024-02-01");
    const state: StreamState = {
      replicationKey: RK,
      replicationKeyValue: fmt("2024-01-01"),
      replicationKeySignpost: signpost,
      progressMarkers: {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-06-01"),
      },
    };
    const result = finalizeStateProgressMarkers(state);
    expect(
      dayjs(result.replicationKeyValue).isAfter(dayjs(signpost).add(1, "second"))
    ).toBe(false);
  });

  it("does not regress below existing replicationKeyValue", () => {
    const state: StreamState = {
      replicationKey: RK,
      replicationKeyValue: fmt("2024-06-01"),
      progressMarkers: {
        replicationKey: RK,
        replicationKeyValue: fmt("2024-03-01"),
      },
    };
    const result = finalizeStateProgressMarkers(state);
    // Should keep the existing higher value
    expect(dayjs(result.replicationKeyValue).isAfter("2024-05-31")).toBe(true);
  });
});
