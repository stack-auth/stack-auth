/**
 * Exercises the Convex driver against a real Convex backend and a real
 * ClickHouse. Everything interesting here is a property of Convex's actual wire
 * format — nanosecond versions past the safe-integer range, tombstones that
 * carry only `_id`, truncates that arrive mid-stream, one cursor covering the
 * whole deployment — and a mock would only test the mock.
 *
 * Writes go through real mutations on the fixture app: the streaming-import
 * endpoint can only insert, and deletes are the whole point of reading a change
 * feed rather than polling.
 *
 * Convex takes a few seconds to make a fresh commit visible to the feed, so every
 * test waits for its writes to appear before syncing. Syncing immediately after a
 * write legitimately returns nothing — see `waitForFeed`.
 *
 * Skipped unless a deployment is pointed at explicitly:
 *
 *   docker compose -f docker/dependencies/docker.compose.yaml up -d convex clickhouse
 *   # then deploy the fixture app; see docker/dependencies/convex-fixture/README.md
 *   HEXCLAVE_DATA_SOURCE_TEST_CONVEX_URL=http://127.0.0.1:8140 \
 *   HEXCLAVE_DATA_SOURCE_TEST_CONVEX_KEY="$(docker exec dependencies-convex-1 ./generate_admin_key.sh | tail -1)" \
 *   HEXCLAVE_DATA_SOURCE_TEST_CLICKHOUSE=http://stackframe:PASSWORD-PLACEHOLDER--9gKyMxJeMx@127.0.0.1:8136 \
 *     pnpm test run apps/backend/src/lib/data-sources/convex/integration.test.ts
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETED_COLUMN, VERSION_COLUMN, getDestinationTableName } from "../clickhouse-destination";
import type { DataSourceConnection, StreamSyncPlan, SyncOutcome } from "../types";
import { convexRequest } from "./client";
import { probeConvex } from "./probe";
import { runConvexStreamSyncs } from "./sync";

const CONVEX_URL = getEnvVariable("HEXCLAVE_DATA_SOURCE_TEST_CONVEX_URL", "") || undefined;
const CONVEX_KEY = getEnvVariable("HEXCLAVE_DATA_SOURCE_TEST_CONVEX_KEY", "") || undefined;
const CLICKHOUSE_URL = getEnvVariable("HEXCLAVE_DATA_SOURCE_TEST_CLICKHOUSE", "") || undefined;
const ENABLED = CONVEX_URL != null && CONVEX_KEY != null && CLICKHOUSE_URL != null;

const connection: DataSourceConnection = {
  type: "convex",
  config: { deploymentUrl: CONVEX_URL ?? "http://127.0.0.1:8140" },
  secret: CONVEX_KEY ?? "",
};
const credentials = { deploymentUrl: connection.config.deploymentUrl as string, deployKey: connection.secret };

const DATA_SOURCE_ID = "00000000-0000-4000-8000-00000000c04e";
const DATABASE_NAME = "hexclave_convex_it";
const TABLE = "it_people";
const DESTINATION_TABLE = getDestinationTableName(DATA_SOURCE_ID, "app", TABLE);

let clickhouse: ClickHouseClient;

/** Calls a mutation on the fixture app. Real writes, so the change feed carries them. */
async function mutate(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await convexRequest(credentials, "/api/mutation", {
    method: "POST",
    body: { path: `fixture:${name}`, args, format: "json" },
  }) as { status: string, value: unknown, errorMessage?: string };
  if (response.status !== "success") {
    throw new Error(`Convex mutation ${name} failed: ${response.errorMessage ?? JSON.stringify(response)}`);
  }
  return response.value;
}

async function addPerson(name: string, age: number, rank: number): Promise<string> {
  return await mutate("addPerson", { name, age, active: true, tags: ["x"], meta: { rank } });
}

function plan(overrides: Partial<StreamSyncPlan> = {}): StreamSyncPlan {
  return {
    streamId: "s-people",
    schemaName: "app",
    tableName: TABLE,
    mode: "cdc",
    cursorColumn: null,
    primaryKeyColumns: ["_id"],
    destinationTable: DESTINATION_TABLE,
    syncCursor: null,
    isPending: true,
    ...overrides,
  };
}

async function sync(plans: StreamSyncPlan[], sourceCursor: unknown): Promise<SyncOutcome> {
  const probe = await probeConvex(connection);
  return await runConvexStreamSyncs({
    connection,
    clickhouse,
    databaseName: DATABASE_NAME,
    tablesByName: new Map(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t])),
    sourceCursor,
    managedResources: null,
    startedAt: new Date(),
    dataSourceId: DATA_SOURCE_ID,
  }, plans);
}

/**
 * Waits until the feed reflects the writes just made.
 *
 * Convex's snapshot is consistent as of a timestamp that trails the latest
 * commit by a few seconds, so a sync run immediately after a mutation can
 * correctly return nothing. Production never notices — the cursor is stored and
 * the next scheduled run picks the change up — but a test that asserted on the
 * first sync would be flaky for a reason that has nothing to do with the driver.
 *
 * Drains a throwaway cursor-less session, which consumes nothing, until the
 * table reports exactly the documents expected.
 *
 * Compares names rather than a row count: a stale snapshot taken a moment before
 * a delete-then-insert has the right number of rows and the wrong ones in them.
 */
async function waitForFeed(expectedNames: string[]): Promise<void> {
  const wanted = [...expectedNames].sort();
  const deadline = Date.now() + 60_000;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    let cursor: string | null = null;
    const live = new Map<string, string>();
    for (let page = 0; page < 100; page++) {
      const body = await convexRequest(credentials, "/api/v1/data/sync", {
        method: "POST",
        body: cursor == null ? {} : { cursor },
      }) as any;
      for (const change of body.values) {
        if (change.table !== TABLE) continue;
        if (change.deleted) live.delete(change.value._id);
        else live.set(change.value._id, change.value.name);
      }
      cursor = body.pagination.nextCursor;
      if (body.status.type === "upToDate") break;
    }
    seen = [...live.values()].sort();
    if (JSON.stringify(seen) === JSON.stringify(wanted)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Convex feed shows ${JSON.stringify(seen)} in ${TABLE}, expected ${JSON.stringify(wanted)}`);
}

/** Reads the destination the way a customer would: deduplicated, tombstones gone. */
async function readDestination(): Promise<Record<string, any>[]> {
  const result = await clickhouse.query({
    query: `SELECT * FROM \`${DATABASE_NAME}\`.\`${DESTINATION_TABLE}\` FINAL
            WHERE \`${DELETED_COLUMN}\` = 0 ORDER BY name`,
    format: "JSONEachRow",
  });
  return await result.json();
}

describe.skipIf(!ENABLED)("Convex data source", () => {
  beforeAll(async () => {
    const url = new URL(CLICKHOUSE_URL!);
    clickhouse = createClient({
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    });
    await clickhouse.command({ query: `DROP DATABASE IF EXISTS \`${DATABASE_NAME}\`` });
    await clickhouse.command({ query: `CREATE DATABASE \`${DATABASE_NAME}\`` });
  }, 120000);

  afterAll(async () => {
    await clickhouse.close();
  });

  // The deployment is persistent, so each test starts by emptying the table
  // rather than assuming it is empty.
  beforeEach(async () => {
    await mutate("clearPeople");
  }, 60000);

  it("probes the deployment and describes its tables", async () => {
    await addPerson("ada", 36, 1);
    await waitForFeed(["ada"]);
    const probe = await probeConvex(connection);
    const table = probe.tables.find(t => t.tableName === TABLE);

    expect(probe.capabilities).toEqual(expect.objectContaining({ type: "convex", hasStreamingExport: true }));
    expect(table).toBeDefined();
    // The root component is reported under a readable namespace, and `_id` is
    // always the key — there is no keyless Convex table.
    expect(table!.schemaName).toBe("app");
    expect(table!.primaryKeyColumns).toEqual(["_id"]);
    expect(table!.cursorCandidates).toEqual([]);

    const columns = Object.fromEntries(table!.columns.map(c => [c.name, c.clickhouseType]));
    expect(columns._id).toBe("String");
    expect(columns._creationTime).toBe("DateTime64(3)");
    expect(columns.name).toBe("String");
    expect(columns.age).toBe("Float64");
    expect(columns.active).toBe("Bool");
    // Nested values keep their JSON text rather than being unpacked.
    expect(columns.tags).toBe("String");
    expect(columns.meta).toBe("String");
  }, 60000);

  it("distinguishes Convex's annotated types, which JSON Schema alone cannot", async () => {
    await mutate("addOddity", { big: { $integer: "KgAAAAAAAAA=" }, blob: { $bytes: "aGVsbG8=" } });
    const probe = await probeConvex(connection);
    const table = probe.tables.find(t => t.tableName === "it_oddities")!;
    const columns = Object.fromEntries(table.columns.map(c => [c.name, c.clickhouseType]));

    // Both are `"type": "string"` in the schema; only the annotation separates them.
    expect(columns.big).toBe("Int64");
    expect(columns.blob).toBe("String");
  }, 60000);

  it("loads a snapshot into the warehouse and returns a resumable cursor", async () => {
    await addPerson("ada", 36, 1);
    await addPerson("grace", 45, 2);
    await waitForFeed(["ada", "grace"]);

    const outcome = await sync([plan()], null);

    expect(outcome.streams[0].error).toBeNull();
    expect(outcome.streams[0].rowsSynced).toBe(2);
    expect(outcome.sourceCursor).toEqual(expect.objectContaining({ mode: "convex" }));

    const rows = await readDestination();
    expect(rows.map(r => r.name)).toEqual(["ada", "grace"]);
    expect(rows[0].age).toBe(36);
    expect(rows[0].active).toBe(true);
    // A nested value is queryable as JSON text rather than lost.
    expect(JSON.parse(rows[0].meta)).toEqual({ rank: 1 });
    // `_creationTime` is a fractional-millisecond float on the wire; it lands as
    // a real timestamp rather than failing the batch.
    expect(rows[0]._hexclave_extracted_at).toBeDefined();
    expect(String(rows[0]._creationTime)).toMatch(/^\d{4}-\d{2}-\d{2} /);
  }, 120000);

  it("carries an insert, an update and a delete through on the incremental cursor", async () => {
    const adaId = await addPerson("ada", 36, 1);
    await addPerson("grace", 45, 2);
    await waitForFeed(["ada", "grace"]);
    const first = await sync([plan()], null);
    expect(first.streams[0].rowsSynced).toBe(2);

    await addPerson("hopper", 50, 3);
    await mutate("setAge", { id: adaId, age: 99 });
    await waitForFeed(["ada", "grace", "hopper"]);

    // isPending false: the incremental path, resuming from the stored cursor.
    const second = await sync([plan({ isPending: false })], first.sourceCursor);
    expect(second.streams[0].error).toBeNull();
    expect(second.streams[0].rowsSynced).toBeGreaterThanOrEqual(2);

    const afterUpdate = await readDestination();
    expect(afterUpdate.map(r => r.name)).toEqual(["ada", "grace", "hopper"]);
    // The update wins over the snapshot row: a later nanosecond version.
    expect(afterUpdate.find(r => r.name === "ada")!.age).toBe(99);

    // A delete arrives as a tombstone carrying only `_id`, and removes the row.
    await mutate("removePerson", { id: adaId });
    await waitForFeed(["grace", "hopper"]);
    const third = await sync([plan({ isPending: false })], second.sourceCursor);
    expect(third.streams[0].error).toBeNull();

    expect((await readDestination()).map(r => r.name)).toEqual(["grace", "hopper"]);
  }, 180000);

  it("versions every row with Convex's nanosecond timestamp, at full precision", async () => {
    await addPerson("ada", 36, 1);
    await waitForFeed(["ada"]);
    const outcome = await sync([plan()], null);
    expect(outcome.streams[0].error).toBeNull();

    const result = await clickhouse.query({
      query: `SELECT toString(\`${VERSION_COLUMN}\`) AS version FROM \`${DATABASE_NAME}\`.\`${DESTINATION_TABLE}\``,
      format: "JSONEachRow",
    });
    const versions = (await result.json<{ version: string }>()).map(r => BigInt(r.version));
    expect(versions.length).toBeGreaterThan(0);

    for (const version of versions) {
      // Nanoseconds since the epoch: past 2^53, which is the whole reason the
      // response is not read with JSON.parse.
      expect(version > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    }
    // A version that had been through a double would be a multiple of 256, since
    // that is the spacing of representable values at this magnitude.
    expect(versions.some(version => version % 256n !== 0n)).toBe(true);
  }, 120000);

  it("rebuilds rather than merges when a stream is reconfigured", async () => {
    await addPerson("ada", 36, 1);
    await waitForFeed(["ada"]);
    const first = await sync([plan()], null);
    expect((await readDestination()).map(r => r.name)).toEqual(["ada"]);

    // A reconfigured stream comes back as pending. Convex has no way to snapshot
    // one table, so the feed is rewound and every selected table is rebuilt —
    // the destination must end up matching the source, not doubled.
    await mutate("clearPeople");
    await addPerson("grace", 45, 2);
    await waitForFeed(["grace"]);
    const rebuilt = await sync([plan({ isPending: true })], first.sourceCursor);

    expect(rebuilt.streams[0].error).toBeNull();
    expect((await readDestination()).map(r => r.name)).toEqual(["grace"]);
  }, 180000);
});
