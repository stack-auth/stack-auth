import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "./clickhouse";
import { dualWriteLegacyEvents, resetLegacyEventsDualWriteCacheForTesting } from "./legacy-telemetry-dual-write";

/**
 * Structural fake for the two methods this module uses (`query` for the
 * system.tables engine probe, `insert` for the mirror write). The real
 * `ClickHouseClient` interface is far larger (command/exec/ping/close, and
 * `query` returns a full ResultSet), so the fake is narrowed with the same
 * `as unknown as ClickHouseClient` pattern the existing ClickHouse fakes use
 * (see spans.test.ts) — a fully-typed fake would have to reimplement the
 * driver's ResultSet surface for zero additional coverage.
 */
function createFakeClickhouseClient(options: {
  engineRows: { engine: string }[],
  insertError?: unknown,
}) {
  const query = vi.fn(async () => ({ json: async () => options.engineRows }));
  const insert = vi.fn(async () => {
    if (options.insertError !== undefined) throw options.insertError;
  });
  return {
    client: { query, insert } as unknown as ClickHouseClient,
    query,
    insert,
  };
}

const ROW = { event_type: "$click", event_at: new Date(1_700_000_000_000), project_id: "p", branch_id: "b" };

describe("dualWriteLegacyEvents", () => {
  beforeEach(() => {
    // The enabled/disabled probe result is process-wide (the physical table's
    // existence is a deployment-phase fact); isolate each case.
    resetLegacyEventsDualWriteCacheForTesting();
  });

  it("mirrors rows into the physical legacy table with the dual_written marker", async () => {
    const { client, query, insert } = createFakeClickhouseClient({ engineRows: [{ engine: "MergeTree" }] });

    await dualWriteLegacyEvents(client, [ROW]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      table: "analytics_internal.events",
      values: [{ ...ROW, dual_written: 1 }],
      clickhouse_settings: expect.objectContaining({
        async_insert: 1,
        wait_for_async_insert: 1,
      }),
    }));

    // The probe is cached: a second batch must not re-query system.tables.
    await dualWriteLegacyEvents(client, [ROW]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("skips the mirror entirely once the name is the read-only compatibility view", async () => {
    const { client, insert } = createFakeClickhouseClient({ engineRows: [{ engine: "View" }] });

    await dualWriteLegacyEvents(client, [ROW]);

    expect(insert).not.toHaveBeenCalled();
  });

  it("skips the mirror entirely when no table owns the legacy name", async () => {
    const { client, insert } = createFakeClickhouseClient({ engineRows: [] });

    await dualWriteLegacyEvents(client, [ROW]);

    expect(insert).not.toHaveBeenCalled();
  });

  it("does not even probe for an empty batch", async () => {
    const { client, query, insert } = createFakeClickhouseClient({ engineRows: [{ engine: "MergeTree" }] });

    await dualWriteLegacyEvents(client, []);

    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("permanently disables itself when the cutover retired the table between probe and insert", async () => {
    // UNKNOWN_TABLE (code 60): the cutover dropped the physical table after
    // our cached probe. The rows are already durable in telemetry, so this is
    // the expected way a process that outlived the cutover learns to stop.
    const { client, insert } = createFakeClickhouseClient({
      engineRows: [{ engine: "MergeTree" }],
      insertError: { code: "60" },
    });

    await expect(dualWriteLegacyEvents(client, [ROW])).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);

    // Disabled from here on: no further insert attempts.
    await dualWriteLegacyEvents(client, [ROW]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("treats the recreated read-only view rejecting the write (code 48) the same way", async () => {
    const { client, insert } = createFakeClickhouseClient({
      engineRows: [{ engine: "MergeTree" }],
      insertError: { code: 48, message: "Method write is not supported by storage View" },
    });

    await expect(dualWriteLegacyEvents(client, [ROW])).resolves.toBeUndefined();
    await dualWriteLegacyEvents(client, [ROW]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not hide an unrelated NOT_IMPLEMENTED error", async () => {
    const { client } = createFakeClickhouseClient({
      engineRows: [{ engine: "MergeTree" }],
      insertError: { code: 48, message: "This feature is not implemented" },
    });

    await expect(dualWriteLegacyEvents(client, [ROW])).rejects.toMatchObject({ code: 48 });
  });

  it("propagates every other insert failure — the legacy table is the customer-visible read surface", async () => {
    const { client, insert } = createFakeClickhouseClient({
      engineRows: [{ engine: "MergeTree" }],
      insertError: new Error("connection reset"),
    });

    await expect(dualWriteLegacyEvents(client, [ROW])).rejects.toThrow("connection reset");

    // A real failure must NOT disable dual-writing: the next request retries.
    await expect(dualWriteLegacyEvents(client, [ROW])).rejects.toThrow("connection reset");
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
