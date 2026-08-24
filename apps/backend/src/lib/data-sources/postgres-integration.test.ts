/**
 * Exercises the SQL this module actually sends against a real Postgres. The
 * catalog queries, the server-side cursor, and the whole CDC path are the parts
 * most likely to be wrong in a way types cannot catch, and mocking them would
 * only test the mock.
 *
 * Skipped unless a server is pointed at explicitly, since it needs one with
 * logical replication enabled:
 *
 *   docker run -d --name hexclave-ds-test -e POSTGRES_PASSWORD=testpass \
 *     -e POSTGRES_DB=appdb -p 55432:5432 postgres:16 \
 *     -c wal_level=logical -c max_replication_slots=10 -c max_wal_senders=10
 *   HEXCLAVE_DATA_SOURCE_TEST_POSTGRES=postgres:testpass@localhost:55432/appdb \
 *     pnpm test run apps/backend/src/lib/data-sources/postgres-integration.test.ts
 */
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { beforeAll, describe, expect, it } from "vitest";
import { probeDataSource } from "./probe";
import { withDataSourceClient } from "./postgres";
import { decodePgoutputMessage, formatLsn, type PgoutputRelation } from "./pgoutput";

const TEST_SERVER = getEnvVariable("HEXCLAVE_DATA_SOURCE_TEST_POSTGRES", "") || undefined;

function parseTestServer(value: string) {
  const url = new URL(`postgresql://${value}`);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || "5432", 10),
    database: url.pathname.replace(/^\//, ""),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: "disable",
  };
}

const credentials = parseTestServer(TEST_SERVER ?? "postgres:postgres@localhost:5432/postgres");

describe.skipIf(!TEST_SERVER)("Postgres data source", () => {

beforeAll(async () => {
  await withDataSourceClient(credentials, async client => {
    await client.query(`DROP TABLE IF EXISTS users, plans, events_noindex, keyless CASCADE`);
    await client.query(`CREATE TABLE users (id bigserial PRIMARY KEY, email text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`CREATE INDEX users_updated_at_idx ON users (updated_at)`);
    await client.query(`CREATE TABLE plans (id int PRIMARY KEY, name text NOT NULL)`);
    await client.query(`CREATE TABLE events_noindex (id bigserial PRIMARY KEY, payload jsonb, modified_at timestamp NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE keyless (a int NOT NULL, b text)`);
    // Backdated so they sit outside the cursor safety lag; the lag test adds a
    // fresh row of its own to check the near edge.
    await client.query(`INSERT INTO users (email, updated_at) SELECT 'u' || g || '@example.com', now() - interval '1 hour' FROM generate_series(1, 500) g`);
    await client.query(`INSERT INTO plans VALUES (1, 'free'), (2, 'pro')`);
    await client.query(`ANALYZE`);
  }, { allowWrites: true });
}, 60000);

it("probes a real server", async () => {
  const result = await probeDataSource(credentials);
  console.log("CAPABILITIES", JSON.stringify(result.capabilities));
  for (const table of result.tables) {
    console.log(`TABLE ${table.schemaName}.${table.tableName} rows=${table.approxRows} pk=[${table.primaryKeyColumns}] cursors=[${table.cursorCandidates.map(c => `${c.column}${c.indexed ? "*" : ""}`).join(",")}] cols=${table.columns.map(c => c.name + ":" + c.dataType).join(",")}`);
  }
  expect(result.capabilities.walLevel).toBe("logical");
  expect(result.tables.map(t => t.tableName).sort()).toEqual(["events_noindex", "keyless", "plans", "users"]);
}, 30000);

it("creates a slot, decodes real WAL, and advances", async () => {
  await withDataSourceClient(credentials, async client => {
    await client.query(`DROP PUBLICATION IF EXISTS hexclave_check`);
    await client.query(`SELECT pg_drop_replication_slot('hexclave_check') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='hexclave_check')`);
    await client.query(`CREATE PUBLICATION hexclave_check FOR TABLE users, plans`);
    await client.query(`SELECT pg_create_logical_replication_slot('hexclave_check', 'pgoutput')`);

    await client.query(`INSERT INTO users (email) VALUES ('cdc-insert@example.com')`);
    await client.query(`UPDATE users SET email = 'cdc-updated@example.com' WHERE email = 'cdc-insert@example.com'`);
    await client.query(`DELETE FROM users WHERE email = 'cdc-updated@example.com'`);

    const changes = await client.query<{ lsn: string, data: Buffer }>(
      `SELECT lsn::text AS lsn, data FROM pg_logical_slot_peek_binary_changes($1, NULL, $2, 'proto_version', '1', 'publication_names', $3)`,
      ["hexclave_check", 1000, "hexclave_check"],
    );
    const relations = new Map<number, PgoutputRelation>();
    const decoded = changes.rows.map(row => decodePgoutputMessage(row.data, relations));
    const kinds = decoded.map(m => m.type);
    console.log("WAL MESSAGES", kinds.join(","));
    console.log("DECODED", JSON.stringify(decoded.filter(m => ["insert", "update", "delete"].includes(m.type))));

    expect(kinds).toContain("insert");
    expect(kinds).toContain("update");
    expect(kinds).toContain("delete");
    expect(relations.size).toBeGreaterThan(0);

    const lastCommit = [...decoded].reverse().find(m => m.type === "commit");
    if (lastCommit?.type !== "commit") throw new Error("no commit decoded");
    const lsnText = formatLsn(lastCommit.endLsn);
    await client.query(`SELECT pg_replication_slot_advance($1, $2::pg_lsn)`, ["hexclave_check", lsnText]);

    const after = await client.query(
      `SELECT count(*)::int AS n FROM pg_logical_slot_peek_binary_changes($1, NULL, NULL, 'proto_version', '1', 'publication_names', $2)`,
      ["hexclave_check", "hexclave_check"],
    );
    console.log("REMAINING AFTER ADVANCE", after.rows[0].n);
    expect(after.rows[0].n).toBe(0);

    await client.query(`SELECT pg_drop_replication_slot('hexclave_check')`);
    await client.query(`DROP PUBLICATION hexclave_check`);
  }, { allowWrites: true });
}, 30000);

/** Records what the engine would write, so the Postgres side can be exercised without ClickHouse. */
function recordingClickhouse() {
  const inserts: { table: string, rows: Record<string, unknown>[] }[] = [];
  const commands: string[] = [];
  return {
    client: {
      command: async ({ query }: { query: string }) => { commands.push(query.trim().split("\n")[0]); },
      query: async () => ({ json: async () => [] }),
      insert: async ({ table, values }: { table: string, values: Record<string, unknown>[] }) => {
        inserts.push({ table, rows: values });
      },
      close: async () => {},
    },
    inserts,
    commands,
  };
}

it("runs cursor mode end to end on the Postgres side", async () => {
  const { probeDataSource } = await import("./probe");
  const { runStreamSyncs } = await import("./sync");
  const probe = await probeDataSource(credentials);
  const tablesByName = new Map(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t]));
  const recorder = recordingClickhouse();

  const context = {
    credentials,
    clickhouse: recorder.client as never,
    databaseName: "wh_test",
    tablesByName,
    slotName: "hexclave_check2",
    publicationName: "hexclave_check2",
    startedAt: new Date("2026-08-21T00:00:00Z"),
  };

  const results = await runStreamSyncs(context, [
    {
      streamId: "s-plans", schemaName: "public", tableName: "plans", mode: "cursor" as const,
      cursorColumn: "id", primaryKeyColumns: ["id"], destinationTable: "public_plans", isPending: false, syncCursor: null,
    },
    {
      streamId: "s-users", schemaName: "public", tableName: "users", mode: "cursor" as const,
      cursorColumn: "id", primaryKeyColumns: ["id"], destinationTable: "public_users", isPending: false, syncCursor: null,
    },
  ]);

  console.log("RESULTS", JSON.stringify(results, null, 2));
  console.log("COMMANDS", JSON.stringify(recorder.commands, null, 2));
  console.log("SAMPLE ROW", JSON.stringify(recorder.inserts.find(i => i.table.includes("plans"))?.rows[0]));
  console.log("USER ROW", JSON.stringify(recorder.inserts.find(i => i.table.includes("users"))?.rows[0]));

  const plans = results.find(r => r.streamId === "s-plans")!;
  const users = results.find(r => r.streamId === "s-users")!;
  expect(plans.error).toBeNull();
  expect(plans.rowsSynced).toBe(2);
  expect(users.error).toBeNull();
  expect(users.rowsSynced).toBe(500);
  expect(users.syncCursor).toMatchObject({ mode: "cursor", value: "500" });
  // The primary key of the last row read rides along, so a group of rows sharing
  // one cursor value can be resumed through instead of re-read forever.
  expect(JSON.parse(users.syncCursor!.key!)).toEqual(["500"]); // bigserial arrives as a string from pg
}, 60000);

it("resumes a cursor stream from its watermark", async () => {
  const { probeDataSource } = await import("./probe");
  const { runStreamSyncs } = await import("./sync");
  const probe = await probeDataSource(credentials);
  const recorder = recordingClickhouse();
  const results = await runStreamSyncs({
    credentials,
    clickhouse: recorder.client as never,
    databaseName: "wh_test",
    tablesByName: new Map(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t])),
    slotName: "x", publicationName: "x", startedAt: new Date(),
  }, [{
    streamId: "s-users", schemaName: "public", tableName: "users", mode: "cursor" as const,
    cursorColumn: "id", primaryKeyColumns: ["id"], destinationTable: "public_users",
    isPending: false,
    syncCursor: { mode: "cursor", value: "495" },
  }]);
  console.log("RESUMED", JSON.stringify(results));
  // Without a stored key the watermark is inclusive, so the boundary row is
  // re-read rather than skipped.
  expect(results[0].rowsSynced).toBe(6);
}, 60000);

it("holds a timestamp cursor back from now(), so a late commit is not skipped", async () => {
  const { probeDataSource } = await import("./probe");
  const { runStreamSyncs } = await import("./sync");

  // Rows written just now sit inside the safety lag and must not be read yet:
  // reading up to now() would move the watermark past a transaction that has not
  // committed, and that row would never be read again.
  await withDataSourceClient(credentials, async client => {
    await client.query(`INSERT INTO users (email, updated_at) VALUES ('fresh@example.com', now())`);
  }, { allowWrites: true });

  const probe = await probeDataSource(credentials);
  const recorder = recordingClickhouse();
  const results = await runStreamSyncs({
    credentials,
    clickhouse: recorder.client as never,
    databaseName: "wh_test",
    tablesByName: new Map(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t])),
    slotName: "x", publicationName: "x", startedAt: new Date(),
  }, [{
    streamId: "s-users", schemaName: "public", tableName: "users", mode: "cursor" as const,
    cursorColumn: "updated_at", primaryKeyColumns: ["id"], destinationTable: "public_users", isPending: false, syncCursor: null,
  }]);

  const emails = recorder.inserts.flatMap(i => i.rows).map(r => r.email);
  expect(emails).not.toContain("fresh@example.com");
  expect(results[0].error).toBeNull();
  expect(results[0].rowsSynced).toBeGreaterThan(0);
}, 60000);

});
