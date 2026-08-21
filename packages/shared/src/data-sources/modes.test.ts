import { describe, expect, it } from "vitest";
import {
  FULL_REFRESH_MAX_ROWS,
  getCdcAvailability,
  getDefaultCursorColumn,
  getModeAvailability,
  getRecommendedMode,
  type DataSourceCapabilities,
  type DataSourceTableInfo,
} from "./modes";

const capable: DataSourceCapabilities = {
  version: "16.4", walLevel: "logical", hasReplication: true,
  inRecovery: false, slotsUsed: 0, slotsMax: 10, probedAtMillis: 0,
};

function table(overrides: Partial<DataSourceTableInfo> = {}): DataSourceTableInfo {
  return {
    schemaName: "public",
    tableName: "users",
    approxRows: 5_000_000,
    primaryKeyColumns: ["id"],
    cursorCandidates: [{ column: "updated_at", dataType: "timestamptz", indexed: true }],
    ...overrides,
  };
}

describe("CDC availability", () => {
  it("is available when the server and table both permit it", () => {
    expect(getCdcAvailability(capable, table())).toEqual({ available: true, reason: null });
  });

  it("reports the blocking condition, in the order a customer can act on", () => {
    expect(getCdcAvailability({ ...capable, walLevel: "replica" }).reason).toBe("needs wal_level=logical");
    expect(getCdcAvailability({ ...capable, hasReplication: false }).reason).toBe("needs REPLICATION grant");
    expect(getCdcAvailability({ ...capable, inRecovery: true }).reason).toBe("not on a read replica");
    expect(getCdcAvailability({ ...capable, slotsUsed: 10 }).reason).toBe("no replication slots free");
  });

  it("blocks a keyless table even on a fully capable server", () => {
    // Without a key there is nothing to match an UPDATE or DELETE against.
    expect(getCdcAvailability(capable, table({ primaryKeyColumns: [] })).reason).toBe("needs a primary key");
  });

  it("does not report a keyless table's problem as a server-level one", () => {
    expect(getCdcAvailability(capable)).toEqual({ available: true, reason: null });
  });
});

describe("mode availability", () => {
  it("refuses cursor mode when no column qualifies", () => {
    const availability = getModeAvailability(table({ cursorCandidates: [] }), capable);
    expect(availability.cursor).toEqual({ available: false, reason: "no usable column" });
  });

  it("refuses full refresh above the row ceiling", () => {
    expect(getModeAvailability(table({ approxRows: FULL_REFRESH_MAX_ROWS + 1 }), capable).full_refresh.available).toBe(false);
    expect(getModeAvailability(table({ approxRows: FULL_REFRESH_MAX_ROWS }), capable).full_refresh.available).toBe(true);
  });
});

describe("recommendation", () => {
  it("reloads small tables wholesale even when CDC is available", () => {
    expect(getRecommendedMode(table({ approxRows: 40 }), capable)).toBe("full_refresh");
  });

  it("prefers CDC for large mutable tables", () => {
    expect(getRecommendedMode(table(), capable)).toBe("cdc");
  });

  it("falls back to a cursor when CDC is unavailable", () => {
    expect(getRecommendedMode(table(), { ...capable, walLevel: "replica" })).toBe("cursor");
  });

  it("returns null when nothing applies, rather than a mode that would fail", () => {
    const impossible = table({ approxRows: 12_600_000, cursorCandidates: [], primaryKeyColumns: [] });
    expect(getRecommendedMode(impossible, { ...capable, walLevel: "replica" })).toBeNull();
  });
});

describe("default cursor column", () => {
  it("prefers an indexed candidate over a conventionally named unindexed one", () => {
    // An unindexed cursor makes every sync a sequential scan, which costs more
    // than picking a less obvious column name.
    const chosen = getDefaultCursorColumn(table({
      cursorCandidates: [
        { column: "updated_at", dataType: "timestamptz", indexed: false },
        { column: "row_version", dataType: "bigint", indexed: true },
      ],
    }));
    expect(chosen).toBe("row_version");
  });

  it("prefers the conventional name among equally indexed candidates", () => {
    const chosen = getDefaultCursorColumn(table({
      cursorCandidates: [
        { column: "created_at", dataType: "timestamptz", indexed: true },
        { column: "updated_at", dataType: "timestamptz", indexed: true },
      ],
    }));
    expect(chosen).toBe("updated_at");
  });

  it("is null when there is nothing to pick", () => {
    expect(getDefaultCursorColumn(table({ cursorCandidates: [] }))).toBeNull();
  });
});
