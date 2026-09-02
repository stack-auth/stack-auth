import { describe, expect, it } from "vitest";
import { getModeAvailability, getRecommendedMode } from "@hexclave/shared/dist/data-sources/modes";
import type { ConvexCapabilities } from "@hexclave/shared/dist/data-sources/modes";
import { componentToSchemaName, mapConvexTypeToClickhouse } from "./probe";

const capabilities: ConvexCapabilities = {
  type: "convex",
  deploymentUrl: "https://example.convex.cloud",
  hasStreamingExport: true,
  probedAtMillis: 0,
};

describe("Convex type mapping", () => {
  it("maps the scalar types Convex reports", () => {
    expect(mapConvexTypeToClickhouse({ type: "string" })).toBe("String");
    expect(mapConvexTypeToClickhouse({ type: "boolean" })).toBe("Bool");
    expect(mapConvexTypeToClickhouse({ type: "number" })).toBe("Float64");
  });

  it("reads Convex's own annotations, which are the only way to tell its richer types apart", () => {
    // All three of these are `"type": "string"` in the JSON Schema; only the
    // $description distinguishes them.
    expect(mapConvexTypeToClickhouse({ type: "string", $description: "Id(users)" })).toBe("String");
    expect(mapConvexTypeToClickhouse({ type: "string", $description: "int64 represented as base10 string" })).toBe("Int64");
    expect(mapConvexTypeToClickhouse({ type: "string", $description: "base64 bytes" })).toBe("String");
  });

  it("keeps nested values as JSON text rather than unpacking them", () => {
    // A Convex table may hold documents of different shapes, so unpacking would
    // mean a destination schema that changes whenever a new shape appears.
    expect(mapConvexTypeToClickhouse({ type: "object", properties: { a: { type: "number" } } })).toBe("String");
    expect(mapConvexTypeToClickhouse({ type: "array", items: { type: "string" } })).toBe("String");
  });

  it("falls back to String for a field with no single type", () => {
    // A field that is sometimes a string and sometimes a number has no column
    // that fits; an unqueryable column is recoverable, a wrong one corrupts.
    expect(mapConvexTypeToClickhouse({ type: ["string", "number"] })).toBe("String");
    expect(mapConvexTypeToClickhouse({})).toBe("String");
  });
});

describe("Convex components as namespaces", () => {
  it("gives the root app a readable name", () => {
    // The empty string would make a destination table called `_users_<hash>` and
    // an odd thing to show in the picker.
    expect(componentToSchemaName("")).toBe("app");
    expect(componentToSchemaName("waitlist")).toBe("waitlist");
  });
});

describe("Convex sync modes", () => {
  const table = {
    schemaName: "app",
    tableName: "users",
    approxRows: null,
    primaryKeyColumns: ["_id"],
    cursorCandidates: [],
  };

  it("offers change data capture and nothing else", () => {
    const availability = getModeAvailability(table, capabilities);
    expect(availability.cdc.available).toBe(true);
    expect(availability.cursor.available).toBe(false);
    // Reported rather than omitted, so the picker can say why the dropdown it
    // renders for Postgres is absent here.
    expect(availability.cursor.reason).toBe("Convex syncs from its change log");
    expect(getRecommendedMode(table, capabilities)).toBe("cdc");
  });

  it("does not apply the Postgres CDC rules to a Convex table", () => {
    // No replica identity, no wal_level, no primary key columns to inspect —
    // a Convex table with none of them is still perfectly syncable.
    expect(getModeAvailability({ ...table, primaryKeyColumns: [] }, capabilities).cdc.available).toBe(true);
  });
});
