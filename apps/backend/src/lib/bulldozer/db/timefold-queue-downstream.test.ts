/**
 * `bulldozer_timefold_process_queue()` must propagate emitted rows through
 * the downstream trigger cascade (filter/map/LFold/...) the same way the
 * inline `setRow` path does via `collectRowChangeTriggerStatements`.
 *
 * Each timefold's cascade template is precomputed at `init()` time and
 * stored in BulldozerTimeFoldDownstreamCascade; the rewritten process_queue
 * populates `__bulldozer_seq` with newly-emitted rows under the timefold's
 * input name and EXECUTEs the template.
 */

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  declareFilterTable,
  declareGroupByTable,
  declareMapTable,
  declareStoredTable,
  declareTimeFoldTable,
  toExecutableSqlTransaction,
  toQueryableSqlQuery,
} from "./index";
import { loadProcessQueueFunctionSql } from "./test-sql-loaders";

type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };
type SqlMapper = { type: "mapper", sql: string };
type SqlPredicate = { type: "predicate", sql: string };

function expr<T>(sql: string): SqlExpression<T> {
  return { type: "expression", sql };
}
function mapper(sql: string): SqlMapper {
  return { type: "mapper", sql };
}
function predicate(sql: string): SqlPredicate {
  return { type: "predicate", sql };
}

const TEST_DB_PREFIX = "stack_bulldozer_queue_downstream_test";

function getTestDbUrls() {
  const env = Reflect.get(import.meta, "env");
  const connectionString = Reflect.get(env, "STACK_DATABASE_CONNECTION_STRING");
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("Missing STACK_DATABASE_CONNECTION_STRING");
  }
  const base = connectionString.replace(/\/[^/]*(\?.*)?$/, "");
  const query = connectionString.split("?")[1] ?? "";
  const dbName = `${TEST_DB_PREFIX}_${Math.random().toString(16).slice(2, 12)}`;
  return {
    full: query.length === 0 ? `${base}/${dbName}` : `${base}/${dbName}?${query}`,
    base,
  };
}

const PROCESS_QUEUE_FN_SQL = loadProcessQueueFunctionSql();

describe.sequential("timefold queue downstream cascade (real postgres)", () => {
  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });

  async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(statements));
  }
  async function readRows(query: SqlQuery) {
    return await sql.unsafe(toQueryableSqlQuery(query));
  }
  async function setLastProcessedAt(isoOrExpression: string) {
    await sql.unsafe(`
      UPDATE "BulldozerTimeFoldMetadata"
      SET "lastProcessedAt" = (${isoOrExpression})::timestamptz,
          "updatedAt" = now()
      WHERE "key" = 'singleton'
    `);
  }
  async function processQueue() {
    await sql.unsafe(`SELECT public.bulldozer_timefold_process_queue()`);
  }
  async function countQueueRows() {
    const rows = await sql<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count" FROM "BulldozerTimeFoldQueue"
    `;
    return rows[0].count;
  }

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  }, 60_000);

  // beforeEach does a lot (drop/recreate all bulldozer tables + install the
  // ~250-line process_queue plpgsql function); the default 10s vitest hook
  // timeout can be tight especially under parallel test files.
  const HOOK_TIMEOUT_MS = 60_000;

  beforeEach(async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`DROP FUNCTION IF EXISTS public.bulldozer_timefold_process_queue()`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldDownstreamCascade"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldQueue"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldMetadata"`;
    await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
    await sql`
      CREATE TABLE "BulldozerStorageEngine" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "keyPath" JSONB[] NOT NULL,
        "keyPathParent" JSONB[] GENERATED ALWAYS AS (
          CASE
            WHEN cardinality("keyPath") = 0 THEN NULL
            ELSE "keyPath"[1:cardinality("keyPath") - 1]
          END
        ) STORED,
        "value" JSONB NOT NULL,
        CONSTRAINT "BulldozerStorageEngine_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BulldozerStorageEngine_keyPath_key" UNIQUE ("keyPath"),
        CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey"
          FOREIGN KEY ("keyPathParent")
          REFERENCES "BulldozerStorageEngine"("keyPath")
          ON DELETE CASCADE
      )
    `;
    await sql`CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent")`;
    await sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES
        (ARRAY[]::jsonb[], 'null'::jsonb),
        (ARRAY[to_jsonb('table'::text)]::jsonb[], 'null'::jsonb)
    `;
    await sql`
      CREATE TABLE "BulldozerTimeFoldQueue" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "tableStoragePath" JSONB[] NOT NULL,
        "groupKey" JSONB NOT NULL,
        "rowIdentifier" TEXT NOT NULL,
        "scheduledAt" TIMESTAMPTZ NOT NULL,
        "stateAfter" JSONB NOT NULL,
        "rowData" JSONB NOT NULL,
        "reducerSql" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BulldozerTimeFoldQueue_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BulldozerTimeFoldQueue_table_group_row_key" UNIQUE ("tableStoragePath", "groupKey", "rowIdentifier")
      )
    `;
    await sql`
      CREATE INDEX "BulldozerTimeFoldQueue_scheduledAt_idx"
      ON "BulldozerTimeFoldQueue"("scheduledAt")
    `;
    await sql`
      CREATE TABLE "BulldozerTimeFoldMetadata" (
        "key" TEXT PRIMARY KEY,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastProcessedAt" TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`
      INSERT INTO "BulldozerTimeFoldMetadata" ("key", "lastProcessedAt")
      VALUES ('singleton', now())
    `;
    await sql`
      CREATE TABLE "BulldozerTimeFoldDownstreamCascade" (
        "tableStoragePath" JSONB[] NOT NULL,
        "cascadeInputName" TEXT NOT NULL,
        "cascadeTemplate" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BulldozerTimeFoldDownstreamCascade_pkey" PRIMARY KEY ("tableStoragePath")
      )
    `;
    // Install the rewritten process_queue function body from the cascade
    // migration.
    await sql.unsafe(PROCESS_QUEUE_FN_SQL);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await sql.end();
    await adminSql.unsafe(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${dbName}'
        AND pid <> pg_backend_pid()
    `);
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await adminSql.end();
  });

  // Reducer that emits {phase:'initial'} inline and schedules a past-due tick
  // that emits {phase:'scheduled'}. The inline recursion stops because
  // nextTimestamp > lastProcessedAt (we back lastProcessedAt off below).
  // After process_queue runs, the scheduled-tick emission must propagate.
  const splitPhaseReducerSql = `
    CASE WHEN "timestamp" IS NULL THEN 1 ELSE 2 END AS "newState",
    jsonb_build_array(
      jsonb_build_object(
        'phase', CASE WHEN "timestamp" IS NULL THEN 'initial' ELSE 'scheduled' END,
        'team', "oldRowData"->'team',
        'value', (("oldRowData"->>'value')::int)
      )
    ) AS "newRowsData",
    CASE
      WHEN "timestamp" IS NULL THEN (now() - interval '1 second')
      ELSE NULL::timestamptz
    END AS "nextTimestamp"
  `;

  /**
   * Reads the `phase` string out of a row's `rowdata` with runtime type
   * checks. Used by the delete-before-drain and dollar-quote tests to
   * assert which phases made it through the pipeline. Fails loud rather
   * than silently returning `undefined` if the row shape is unexpected.
   *
   * Takes `unknown` (rather than a narrower row type) because the
   * `postgres.js` driver's `Row` type doesn't statically guarantee a
   * `rowdata` column.
   */
  function rowPhase(row: unknown): string {
    if (row == null || typeof row !== "object") {
      throw new Error(`Expected row object, got ${typeof row}`);
    }
    const rowData = Reflect.get(row, "rowdata");
    if (rowData == null || typeof rowData !== "object") {
      throw new Error(`Expected object rowdata, got ${typeof rowData}`);
    }
    const phase = Reflect.get(rowData, "phase");
    if (typeof phase !== "string") {
      throw new Error(`Expected string 'phase' field in rowdata, got ${typeof phase}: ${JSON.stringify(rowData)}`);
    }
    return phase;
  }

  // ────────────────────────────────────────────────────────────────────
  // Test 1: single filter downstream
  // ────────────────────────────────────────────────────────────────────
  test("process_queue propagates emissions to a single downstream filter", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-filter-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-filter-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-filter-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-filter-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    // Back the clock up before any setRow so the inline recursion bails.
    // Use pre-epoch time so the reducer's scheduled tick (now()-1s) stays
    // ahead of lastProcessedAt regardless of wall-clock drift.
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":7}'::jsonb`)));

    expect(await countQueueRows()).toBe(1);
    const filteredBeforeDrain = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(filteredBeforeDrain).toEqual([]);

    await setLastProcessedAt(`now()`);
    await processQueue();

    const filteredAfterDrain = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    // Filter wraps rows through an internal flat-map that appends a
    // flatIndex to the rowIdentifier (":1" for the single-element array).
    // That's an implementation detail, not something to assert on.
    expect(filteredAfterDrain.map((row) => row.rowdata)).toEqual([
      { phase: "scheduled", team: "alpha", value: 7 },
    ]);
    expect(await countQueueRows()).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 2: multi-stage cascade (timefold → filter → map → map)
  // Exercises transitive propagation across three downstream stages.
  // ────────────────────────────────────────────────────────────────────
  test("process_queue propagates emissions through filter → map → map", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-multistage-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-multistage-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-multistage-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-multistage-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });
    const mappedTable = declareMapTable({
      tableId: "queue-cascade-multistage-u-mapped",
      fromTable: filteredTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int * 10) AS "valueTimesTen"
      `),
    });
    const reMappedTable = declareMapTable({
      tableId: "queue-cascade-multistage-u-remapped",
      fromTable: mappedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'valueTimesTen')::int + 1) AS "valueTimesTenPlusOne"
      `),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());
    await runStatements(mappedTable.init());
    await runStatements(reMappedTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    expect(await countQueueRows()).toBe(2);
    for (const table of [filteredTable, mappedTable, reMappedTable]) {
      const rows = await readRows(table.listRowsInGroup({
        groupKey: expr(`to_jsonb('alpha'::text)`),
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      }));
      expect(rows).toEqual([]);
    }

    await setLastProcessedAt(`now()`);
    await processQueue();

    const filtered = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(filtered.map((r) => r.rowdata).sort((a, b) =>
      Number(Reflect.get(a as object, "value")) - Number(Reflect.get(b as object, "value"))
    )).toEqual([
      { phase: "scheduled", team: "alpha", value: 3 },
      { phase: "scheduled", team: "alpha", value: 5 },
    ]);

    const mapped = await readRows(mappedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(mapped.map((r) => r.rowdata).sort((a, b) =>
      Number(Reflect.get(a as object, "valueTimesTen")) - Number(Reflect.get(b as object, "valueTimesTen"))
    )).toEqual([
      { team: "alpha", valueTimesTen: 30 },
      { team: "alpha", valueTimesTen: 50 },
    ]);

    const reMapped = await readRows(reMappedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(reMapped.map((r) => r.rowdata).sort((a, b) =>
      Number(Reflect.get(a as object, "valueTimesTenPlusOne")) - Number(Reflect.get(b as object, "valueTimesTenPlusOne"))
    )).toEqual([
      { team: "alpha", valueTimesTenPlusOne: 31 },
      { team: "alpha", valueTimesTenPlusOne: 51 },
    ]);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 3: inline path and queue path produce identical downstream state
  // ────────────────────────────────────────────────────────────────────
  test("inline-drain and queue-drain produce identical downstream state", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-parity-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-parity-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-parity-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-parity-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());

    // Customer "inline": lastProcessedAt way ahead → tick fires inline.
    await setLastProcessedAt(`'2099-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());
    await runStatements(fromTable.setRow("inline-u1", expr(`'{"team":"inline","value":9}'::jsonb`)));
    expect(await countQueueRows()).toBe(0);

    // Customer "queue": lastProcessedAt behind → tick queued.
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(fromTable.setRow("queue-u1", expr(`'{"team":"queue","value":9}'::jsonb`)));
    expect(await countQueueRows()).toBe(1);

    await setLastProcessedAt(`now()`);
    await processQueue();
    expect(await countQueueRows()).toBe(0);

    const inlineRows = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('inline'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    const queueRows = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('queue'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));

    const normalize = (rows: ReadonlyArray<Record<string, unknown>>) =>
      rows.map((row) => {
        const rowIdentifier = row.rowidentifier;
        if (typeof rowIdentifier !== "string") throw new Error("expected string rowidentifier");
        const rowData = row.rowdata;
        if (rowData == null || typeof rowData !== "object") throw new Error("expected object rowdata");
        return {
          rowIdentifierSuffix: rowIdentifier.replace(/^(inline|queue)-u1:/, "u1:"),
          rowData: {
            ...(rowData as Record<string, unknown>),
            team: "<normalized>",
          },
        };
      });

    expect(normalize([...queueRows])).toEqual(normalize([...inlineRows]));
    expect([...inlineRows]).not.toEqual([]);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 4: idempotency — redraining with no new rows is a no-op
  // ────────────────────────────────────────────────────────────────────
  test("process_queue is idempotent when there is nothing new to drain", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-idempotency-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-idempotency-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-idempotency-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-idempotency-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":4}'::jsonb`)));
    await setLastProcessedAt(`now()`);

    await processQueue();
    const afterFirstDrain = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(afterFirstDrain).toHaveLength(1);

    // Second drain: no due queue rows. No-op at every layer.
    await processQueue();
    const afterSecondDrain = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(afterSecondDrain).toEqual(afterFirstDrain);
    expect(await countQueueRows()).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 5: deleting a downstream table must NOT wedge process_queue.
  //
  // The cascade template is compiled at upstream-init() time and
  // references the downstream's storage paths. If the downstream is
  // .delete()d while the upstream still has queue rows pending, the
  // drain must still succeed without a FK violation. The safety comes
  // from every trigger's first statement carrying a
  // `WHERE isInitializedExpression` clause that short-circuits the rest
  // of the pipeline when the downstream's metadata row is absent. The
  // queue-drain cascade inherits the same statements verbatim, so it
  // inherits the same safety — this test pins that invariant down.
  // ────────────────────────────────────────────────────────────────────
  test("process_queue does not wedge when a downstream table is deleted", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-deleted-downstream-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-deleted-downstream-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-deleted-downstream-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-deleted-downstream-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":7}'::jsonb`)));
    expect(await countQueueRows()).toBe(1);

    // At this point the inline setRow path has already propagated the
    // {phase:initial} row all the way through to the filter's storage.
    // Blow the filter's storage away while the {phase:scheduled} tick
    // is still queued — the upstream's cascade template was compiled
    // referencing the filter's paths and is NOT updated by .delete(),
    // so this is the delete-before-drain scenario.
    await runStatements(filteredTable.delete());

    await setLastProcessedAt(`now()`);
    // If the cascade template's WHERE-gated statements didn't no-op on
    // missing downstream storage, this would throw an FK violation and
    // the queue would stay wedged forever.
    await processQueue();

    expect(await countQueueRows()).toBe(0);

    // The timefold's own state must reflect both emissions (the inline
    // {initial} from before the delete and the queue-drained {scheduled}
    // from after). A wedged drain would roll everything back and leave
    // the timefold with only the initial row.
    const timefoldRows = await readRows(timeFoldTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(timefoldRows.map(rowPhase).sort()).toEqual(["initial", "scheduled"]);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 6: statements whose SQL contains `$tf_cascade$` as a literal
  // substring must not prematurely close the outer cascade DO-block.
  //
  // The cascade template is wrapped in `DO $tf_cascade$ ... $tf_cascade$`.
  // If any embedded statement happens to include that literal — e.g. in
  // a SQL comment or a user-provided expression — the outer dollar quote
  // closes mid-body and EXECUTE fails at parse time.
  // ────────────────────────────────────────────────────────────────────
  test("process_queue tolerates downstream SQL containing the cascade dollar-quote delimiter", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-dollar-collision-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-dollar-collision-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-dollar-collision-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    // The filter predicate embeds the literal `$tf_cascade$` in a way
    // that always evaluates true. This text flows through
    // `collectRowChangeTriggerStatements` into the stored cascade
    // template verbatim, so if the outer dollar-quoting is not robust,
    // parse time EXECUTE inside process_queue will fail.
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-dollar-collision-u-all",
      fromTable: timeFoldTable,
      filter: predicate(`('$tf_cascade$' IS NOT NULL) OR ("rowData"->>'phase' = 'scheduled')`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":11}'::jsonb`)));
    expect(await countQueueRows()).toBe(1);

    await setLastProcessedAt(`now()`);
    // If the outer dollar-quote delimiter collided with the embedded
    // `$tf_cascade$` string, EXECUTE raises `syntax error at or near ...`
    // and the entire drain rolls back (queue stays at 1). The fix
    // (`chooseSafeDollarQuoteTag`) randomizes the outer tag per call, so
    // the embedded literal is just another string in the body.
    await processQueue();

    expect(await countQueueRows()).toBe(0);

    // Predicate evaluates to always-true thanks to the first disjunct,
    // so both the inline-emitted {initial} row and the queue-drained
    // {scheduled} row make it through. The point of the assertion is
    // that the cascade ran and wrote the scheduled row at all — if the
    // delimiter collision had broken the DO block, we'd see only
    // {initial} (written synchronously at setRow time, before the queue
    // drain).
    const filteredRows = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(filteredRows.map(rowPhase).sort()).toEqual(["initial", "scheduled"]);
  });

  // ────────────────────────────────────────────────────────────────────
  // when process_queue() can't find a cascade
  // registry row for a timefold, it must DEFER that timefold's queue
  // rows (leave them queued) instead of draining them and silently
  // skipping the downstream cascade.
  //
  // Why this matters — a concrete example of the failure mode:
  //
  //   1. This migration (20260417000000) creates the registry table
  //      BulldozerTimeFoldDownstreamCascade. It's empty at first.
  //
  //   2. The backend starts up. `declareTimeFoldTable.init()` runs for
  //      every timefold and upserts one row per timefold into the
  //      registry, storing the pre-compiled cascade SQL template.
  //
  //   3. There is a short gap between (1) and (2). During that gap,
  //      pg_cron keeps calling process_queue() every second.
  //
  //   4. If a due queue row exists for a timefold whose registry row
  //      hasn't been upserted yet, and process_queue() drains it
  //      anyway without a cascade to run, then:
  //
  //        - the queue row is gone,
  //        - the timefold's own state is updated,
  //        - but NONE of the downstream filters/maps/LFolds hear
  //          about it, and there's no queue row left for a future
  //          tick to retry.
  //
  //      → downstream tables are permanently desynchronized from
  //        the timefold.
  //
  // The right behavior: no registry row → do nothing for this
  // timefold this tick. The queue row stays queued. Once init()
  // finishes and the registry row appears, the next pg_cron tick
  // drains with cascade intact.
  //
  // This test simulates the deploy-window gap by deleting the
  // registry row after init() has run (so we know the rest of the
  // pipeline is set up), then calling process_queue() and asserting
  // that nothing silently advanced.
  // ────────────────────────────────────────────────────────────────────
  test("process_queue defers a timefold whose cascade registry row is missing", async () => {
    // ---- Setup: build a small timefold pipeline ----
    //
    // The chain is: source data → group by team → timefold (recurses
    // through time) → filter (keeps only phase=scheduled rows).
    //
    // Calling each table's init() wires up its storage. The
    // timeFoldTable's init() is the one that inserts the registry
    // row we care about — it stores the cascade template that
    // process_queue() looks up at drain time.
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "queue-cascade-missing-registry-u" });
    const groupedTable = declareGroupByTable({
      tableId: "queue-cascade-missing-registry-u-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const timeFoldTable = declareTimeFoldTable({
      tableId: "queue-cascade-missing-registry-u-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(splitPhaseReducerSql),
    });
    const filteredTable = declareFilterTable({
      tableId: "queue-cascade-missing-registry-u-scheduled-only",
      fromTable: timeFoldTable,
      filter: predicate(`"rowData"->>'phase' = 'scheduled'`),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    // Backdate the "last processed" clock so any future tick the
    // reducer schedules looks like it's still in the future when
    // setRow fires. That way the {scheduled} emission gets QUEUED
    // instead of running inline.
    await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);
    await runStatements(timeFoldTable.init());
    await runStatements(filteredTable.init());

    // ---- Generate one inline emission + one queued emission ----
    //
    // splitPhaseReducerSql is written so:
    //   - First call (timestamp=NULL) emits {phase:'initial'} and
    //     schedules a future tick.
    //   - The future tick (when drained) emits {phase:'scheduled'}.
    //
    // setRow fires the inline path: {initial} flows through the
    // whole chain right now. The filter predicate
    // `"rowData"->>'phase' = 'scheduled'` rejects {initial}, so the
    // filter stays empty. Meanwhile the scheduled tick lands in
    // BulldozerTimeFoldQueue for later.
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":7}'::jsonb`)));
    expect(await countQueueRows()).toBe(1);

    // ---- Simulate the deploy-window gap ----
    //
    // We just saw init() upsert a registry row above. To mimic the
    // case where init() hasn't run yet (migration applied but
    // backend hasn't reached init() for this timefold), delete
    // every row in the registry table by hand. Now it looks
    // identical to the fresh-after-migration state.
    await sql.unsafe(`DELETE FROM "BulldozerTimeFoldDownstreamCascade"`);

    // ---- Run process_queue() as pg_cron would ----
    //
    // Advance the clock past the queued tick's scheduledAt so it's
    // due, then drain.
    await setLastProcessedAt(`now()`);
    await processQueue();

    // ---- Assert we deferred instead of silently losing state ----
    //
    // (1) The queue row is still there. process_queue() saw that
    //     the registry had no row for this timefold and said "I
    //     don't know which cascade to run, so I'll leave this for
    //     the next tick." Nothing was drained, nothing was
    //     skipped.
    expect(await countQueueRows()).toBe(1);

    // (2) The timefold's own state wasn't advanced by the drain.
    //     Only the inline-emitted {initial} row is visible; the
    //     {scheduled} row is still sitting in the queue waiting
    //     for a tick with a registered cascade to process it.
    //
    //     Contrast with the buggy (pre-fix) behavior: the timefold
    //     would have had BOTH "initial" and "scheduled" here, with
    //     the filter permanently missing "scheduled".
    const timefoldRows = await readRows(timeFoldTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(timefoldRows.map(rowPhase).sort()).toEqual(["initial"]);

    // (3) The filter is empty, which is the correct steady state:
    //     the inline setRow's {initial} was filtered out, and the
    //     {scheduled} row hasn't been drained yet. No partial
    //     writes, no orphan rows. Once init() runs and the
    //     registry is populated, the next pg_cron tick will drain
    //     the queue row and propagate {scheduled} into this
    //     filter.
    const filterRows = await readRows(filteredTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
    expect(filterRows).toEqual([]);
  });
});
