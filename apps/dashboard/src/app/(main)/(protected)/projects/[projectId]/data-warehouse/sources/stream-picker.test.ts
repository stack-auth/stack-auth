import type { DataSourceCatalogJson, DataSourceCatalogTableJson, DataSourceStreamConfig } from "@hexclave/shared/dist/interface/admin-interface";
import { describe, expect, it } from "vitest";
import { buildInitialSelection, getExplainedModes, hasNoModeChoice, showsModeComparison } from "./stream-picker";

function table(tableName: string): DataSourceCatalogTableJson {
  return {
    schema_name: "public",
    table_name: tableName,
    approx_rows: 10,
    postgres: { replica_identity: "d", is_partitioned: false },
    primary_key_columns: ["id"],
    cursor_candidates: [{ column: "id", data_type: "bigint", indexed: true }],
    available_modes: [
      { mode: "cdc", available: true, reason: null },
      { mode: "cursor", available: true, reason: null },
    ],
    recommended_mode: "cdc",
    default_cursor_column: "id",
  };
}

const catalog: DataSourceCatalogJson = {
  capabilities: {
    type: "postgres",
    version: "16.4",
    wal_level: "logical",
    has_replication: true,
    in_recovery: false,
    slots_used: 0,
    slots_max: 10,
    probed_at_millis: 0,
  },
  tables: ["users", "audit_log"].map(table),
};

describe("StreamPicker initial selection", () => {
  it("selects recommended tables during initial setup", () => {
    const selection = buildInitialSelection(catalog, undefined);

    expect(selection["public.users"]?.on).toBe(true);
    expect(selection["public.audit_log"]?.on).toBe(true);
  });

  it("selects only configured streams while editing", () => {
    const existing: DataSourceStreamConfig[] = [{
      schema_name: "public",
      table_name: "users",
      mode: "cursor",
      cursor_column: "id",
    }];

    const selection = buildInitialSelection(catalog, existing);

    expect(selection["public.users"]).toEqual({ on: true, mode: "cursor", cursorColumn: "id" });
    expect(selection["public.audit_log"]?.on).toBe(false);
  });

  it("keeps every table off when editing a source with no configured streams", () => {
    const selection = buildInitialSelection(catalog, []);

    expect(Object.values(selection).every(value => value?.on === false)).toBe(true);
  });
});

describe("whether the mode dropdown is worth showing", () => {
  function withModes(cdc: boolean, cursor: boolean): DataSourceCatalogTableJson {
    return {
      ...table("users"),
      available_modes: [
        { mode: "cdc", available: cdc, reason: cdc ? null : "needs wal_level=logical" },
        { mode: "cursor", available: cursor, reason: cursor ? null : "no usable column" },
      ],
    };
  }

  it("hides it when the one possible mode is already the one selected", () => {
    // A Convex table: change-log only, and always on it.
    expect(hasNoModeChoice(withModes(true, false), "cdc")).toBe(true);
  });

  it("shows it when the only available mode is not the one selected", () => {
    // A Postgres source stored as `cdc` whose server later lost CDC eligibility.
    // Hiding the dropdown here would display "CDC" with no way to change it, and
    // the save would then be rejected by the backend.
    expect(hasNoModeChoice(withModes(false, true), "cdc")).toBe(false);
  });

  it("shows it whenever there is a genuine choice", () => {
    expect(hasNoModeChoice(withModes(true, true), "cdc")).toBe(false);
  });
});

describe("which sync modes the picker explains", () => {
  function tableWith(cdc: boolean, cursor: boolean): DataSourceCatalogTableJson {
    return {
      ...table("users"),
      available_modes: [
        { mode: "cdc", available: cdc, reason: cdc ? null : "needs wal_level=logical" },
        { mode: "cursor", available: cursor, reason: cursor ? null : "Convex syncs from its change log" },
      ],
    };
  }

  it("explains only the one mode a Convex source has", () => {
    // Cursor is structurally impossible here, not switched off — saying
    // "available on 0 of N tables" describes a choice that does not exist.
    expect(getExplainedModes([tableWith(true, false)], false)).toEqual(["cdc"]);
  });

  it("still explains CDC when it is off for a reason the customer can fix", () => {
    // A Postgres server without wal_level=logical: the row is what carries the
    // "To enable CDC" remediation, so dropping it would hide the fix.
    expect(getExplainedModes([tableWith(false, true)], true)).toEqual(["cdc", "cursor"]);
  });

  it("drops a mode that is neither usable nor fixable", () => {
    expect(getExplainedModes([tableWith(false, true)], false)).toEqual(["cursor"]);
  });

  it("explains both when there is a genuine choice", () => {
    expect(getExplainedModes([tableWith(true, true)], false)).toEqual(["cdc", "cursor"]);
  });
});

describe("whether the mode-comparison card is shown", () => {
  it("is hidden when there is one mode and nothing to fix", () => {
    // A Convex source. The card would be a heading over one sentence.
    expect(showsModeComparison(["cdc"], false)).toBe(false);
  });

  it("is shown when CDC is off for a reason the customer can fix", () => {
    // The card is what carries the "To enable CDC" remediation.
    expect(showsModeComparison(["cdc"], true)).toBe(true);
  });

  it("is shown whenever there is a real comparison to draw", () => {
    expect(showsModeComparison(["cdc", "cursor"], false)).toBe(true);
  });

  it("is hidden when no mode applies at all", () => {
    // Every table row already says "No mode available"; an empty card adds nothing.
    expect(showsModeComparison([], false)).toBe(false);
  });
});
