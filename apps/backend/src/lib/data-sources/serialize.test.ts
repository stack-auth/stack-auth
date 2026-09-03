import { describe, expect, it } from "vitest";
import { serializeCatalog } from "./serialize";
import type { DataSourceProbeResult } from "./types";

describe("data source serialization", () => {
  it("preserves an unknown replication slot maximum as null across JSON", () => {
    const probe: DataSourceProbeResult = {
      capabilities: {
        type: "postgres",
        version: "16.4",
        walLevel: "logical",
        hasReplication: true,
        inRecovery: false,
        slotsUsed: 0,
        slotsMax: null,
        probedAtMillis: 0,
      },
      tables: [],
    };

    const serialized = serializeCatalog(probe);

    expect(serialized.capabilities).toEqual(expect.objectContaining({ type: "postgres", slots_max: null }));
    expect(JSON.stringify(serialized)).toContain('"slots_max":null');
  });

  it("keeps the discriminator on Convex capabilities, and omits Postgres-only fields", () => {
    // The whole point of the union: a Convex source must not be described with a
    // wal_level, and the dashboard has to be able to tell which it is looking at.
    const probe: DataSourceProbeResult = {
      capabilities: {
        type: "convex",
        deploymentUrl: "https://example.convex.cloud",
        probedAtMillis: 0,
      },
      tables: [],
    };

    const serialized = serializeCatalog(probe);

    expect(serialized.capabilities).toEqual({
      type: "convex",
      deployment_url: "https://example.convex.cloud",
      probed_at_millis: 0,
    });
    expect(JSON.stringify(serialized)).not.toContain("wal_level");
  });
});
