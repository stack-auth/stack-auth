import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Table } from "./index";
import {
  declareCompactTable as _declareCompactTable,
  declareConcatTable as _declareConcatTable,
  declareFilterTable as _declareFilterTable,
  declareFlatMapTable as _declareFlatMapTable,
  declareGroupByTable as _declareGroupByTable,
  declareLeftJoinTable as _declareLeftJoinTable,
  declareLFoldTable as _declareLFoldTable,
  declareLimitTable as _declareLimitTable,
  declareMapTable as _declareMapTable,
  declareReduceTable as _declareReduceTable,
  declareSortTable as _declareSortTable,
  declareStoredTable as _declareStoredTable,
  declareTimeFoldTable as _declareTimeFoldTable,
  toExecutableSqlTransaction,
  toQueryableSqlQuery,
} from "./index";

// any is used here because the verifier works with heterogeneous table types
const allInitializedTables: Table<any, any, any>[] = [];
function trackTable<T extends Table<any, any, any>>(table: T): T {
  allInitializedTables.push(table);
  return table;
}
function tracked<Fn extends (...args: any[]) => Table<any, any, any>>(fn: Fn): Fn {
  return ((...args: unknown[]) => trackTable(fn(...args))) as Fn;
}

const declareCompactTable = tracked(_declareCompactTable);
const declareConcatTable = tracked(_declareConcatTable);
const declareFilterTable = tracked(_declareFilterTable);
const declareFlatMapTable = tracked(_declareFlatMapTable);
const declareGroupByTable = tracked(_declareGroupByTable);
const declareLeftJoinTable = tracked(_declareLeftJoinTable);
const declareLFoldTable = tracked(_declareLFoldTable);
const declareLimitTable = tracked(_declareLimitTable);
const declareMapTable = tracked(_declareMapTable);
const declareReduceTable = tracked(_declareReduceTable);
const declareSortTable = tracked(_declareSortTable);
const declareStoredTable = tracked(_declareStoredTable);
const declareTimeFoldTable = tracked(_declareTimeFoldTable);

type TestDb = { full: string, base: string };
type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };

type WorkloadOperation =
  | { type: "upsert", rowIdentifier: string, team: string | null, value: number }
  | { type: "delete", rowIdentifier: string };

const TEST_DB_PREFIX = "stack_bulldozer_db_perf_test";
const DEFAULT_WARMUP_OPS = 40;
const DEFAULT_MEASURED_OPS = 200;
const IS_CI = (() => {
  const env = Reflect.get(import.meta, "env");
  const ci = Reflect.get(env, "CI");
  const cursorAgent = Reflect.get(env, "CURSOR_AGENT");
  return (ci === true || ci === "true" || ci === "1") && (cursorAgent !== true && cursorAgent !== 'true' && cursorAgent !== "1");
})();
const CI_PERF_MAX_MS_MULTIPLIER = IS_CI ? 2 : 1;
const withCiPerfHeadroom = (maxMs: number) => maxMs * CI_PERF_MAX_MS_MULTIPLIER;
const LOAD_ROW_COUNTS = IS_CI ? [20_000, 50_000] : [20_000, 50_000, 200_000];
const LOAD_PREFILL_MAX_MS = withCiPerfHeadroom(30_000);
const LOAD_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(5_000);
const LOAD_POINT_MUTATION_MAX_MS = withCiPerfHeadroom(400);
const LOAD_SET_ROW_AVG_ITERATIONS = 10;
const LOAD_SET_ROW_AVG_MAX_MS = withCiPerfHeadroom(50);
const LOAD_ONLINE_MUTATION_ITERATIONS = 5;
const LOAD_ONLINE_MUTATION_MAX_MS = withCiPerfHeadroom(50);
const LOAD_SUBSET_ITERATION_MAX_MS = withCiPerfHeadroom(50);
const LOAD_SUBSET_ITERATION_ROW_COUNT = 1_000;
const LOAD_SUBSET_ITERATION_MEASURED_RUNS = 5;
const LOAD_TABLE_DELETE_MAX_MS = withCiPerfHeadroom(20_000);
const LOAD_DERIVED_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_DERIVED_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(10_000);
const LOAD_EXPANDING_INIT_MAX_MS = withCiPerfHeadroom(120_000);
const LOAD_EXPANDING_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(15_000);
const LOAD_FILTERED_QUERY_MAX_MS = withCiPerfHeadroom(4_000);
const LOAD_FILTER_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_FILTER_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const LOAD_LIMIT_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_LIMIT_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const LOAD_CONCAT_TABLE_INIT_MAX_MS = withCiPerfHeadroom(10_000);
const LOAD_CONCAT_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const LOAD_SORT_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_SORT_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const LOAD_LFOLD_TABLE_INIT_MAX_MS = withCiPerfHeadroom(130_000);
const LOAD_LFOLD_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(12_000);
const LOAD_TIMEFOLD_TABLE_INIT_MAX_MS = withCiPerfHeadroom(130_000);
const LOAD_TIMEFOLD_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(12_000);
const LOAD_LEFT_JOIN_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_LEFT_JOIN_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const STACKED_MAP_PIPELINE_MUTATION_MAX_MS = withCiPerfHeadroom(400);
const VIRTUAL_CONCAT_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(500);
const VIRTUAL_CONCAT_LOAD_ROW_COUNT = 5_000;
const LOAD_COMPACT_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_COMPACT_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);
const LOAD_REDUCE_TABLE_INIT_MAX_MS = withCiPerfHeadroom(90_000);
const LOAD_REDUCE_TABLE_COUNT_QUERY_MAX_MS = withCiPerfHeadroom(8_000);

function getTestDbUrls(): TestDb {
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

function expr<T>(sql: string): SqlExpression<T> {
  return { type: "expression", sql };
}

function jsonbLiteral(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function choose<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)] ?? values[0];
}

function createWorkload(seed: number, operationCount: number): WorkloadOperation[] {
  const rng = createRng(seed);
  const identifiers = ["u1", "u2", "u3", "u4", "u:5", "u 6", "u/7", "u'8"] as const;
  const teams = ["alpha", "beta", "gamma", null] as const;
  const existing = new Set<string>();
  const operations: WorkloadOperation[] = [];

  for (let i = 0; i < operationCount; i++) {
    const roll = rng();
    if (roll < 0.74) {
      const rowIdentifier = choose(rng, identifiers);
      const team = choose(rng, teams);
      const value = Math.floor(rng() * 100);
      operations.push({ type: "upsert", rowIdentifier, team, value });
      existing.add(rowIdentifier);
    } else {
      const rowIdentifier = existing.size > 0
        ? choose(rng, [...existing])
        : choose(rng, identifiers);
      operations.push({ type: "delete", rowIdentifier });
      existing.delete(rowIdentifier);
    }
  }

  return operations;
}

function logLine(message: string): void {
  console.log(`${message}\n`);
}

describe.sequential("bulldozer db performance (real postgres)", () => {
  vi.setConfig({ testTimeout: 180_000 });
  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });
  const PERF_STATEMENT_TIMEOUT = "180s";

  async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(statements, { statementTimeout: PERF_STATEMENT_TIMEOUT }));
  }

  async function readRows(query: SqlQuery) {
    return await sql.unsafe(toQueryableSqlQuery(query));
  }

  async function measureMs<T>(label: string, fn: () => Promise<T>): Promise<{ result: T, elapsedMs: number }> {
    const startedAt = performance.now();
    const result = await fn();
    const elapsedMs = performance.now() - startedAt;
    logLine(`[bulldozer-perf] ${label}: ${elapsedMs.toFixed(1)} ms`);
    return { result, elapsedMs };
  }

  function summarizeMs(samplesMs: number[]): {
    averageMs: number,
    trimmedAverageMs: number,
    medianMs: number,
    varianceMs2: number,
    stdDevMs: number,
    minMs: number,
    maxMs: number,
  } {
    const sortedMs = [...samplesMs].sort((a, b) => a - b);
    const averageMs = samplesMs.reduce((acc, value) => acc + value, 0) / samplesMs.length;
    const varianceMs2 = samplesMs.reduce((acc, value) => acc + ((value - averageMs) ** 2), 0) / samplesMs.length;
    const stdDevMs = Math.sqrt(varianceMs2);
    const minMs = sortedMs[0] ?? 0;
    const maxMs = sortedMs[sortedMs.length - 1] ?? 0;
    const midpoint = Math.floor(sortedMs.length / 2);
    const medianMs = sortedMs.length % 2 === 0
      ? (((sortedMs[midpoint - 1] ?? 0) + (sortedMs[midpoint] ?? 0)) / 2)
      : (sortedMs[midpoint] ?? 0);
    const trimmedSamples = sortedMs.length >= 5 ? sortedMs.slice(1, -1) : sortedMs;
    const trimmedAverageMs = trimmedSamples.reduce((acc, value) => acc + value, 0) / trimmedSamples.length;
    return { averageMs, trimmedAverageMs, medianMs, varianceMs2, stdDevMs, minMs, maxMs };
  }

  async function prefillStoredTableInSingleStatement(tableId: string, rowCount: number): Promise<void> {
    const externalId = `external:${tableId}`;
    await sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      SELECT "seedRows"."keyPath", "seedRows"."value"
      FROM (
        VALUES
          (ARRAY[to_jsonb('table'::text), to_jsonb(${externalId}::text)]::jsonb[], 'null'::jsonb),
          (ARRAY[to_jsonb('table'::text), to_jsonb(${externalId}::text), to_jsonb('storage'::text)]::jsonb[], 'null'::jsonb),
          (ARRAY[to_jsonb('table'::text), to_jsonb(${externalId}::text), to_jsonb('storage'::text), to_jsonb('rows'::text)]::jsonb[], 'null'::jsonb),
          (ARRAY[to_jsonb('table'::text), to_jsonb(${externalId}::text), to_jsonb('storage'::text), to_jsonb('metadata'::text)]::jsonb[], '{ "version": 1 }'::jsonb)
      ) AS "seedRows"("keyPath", "value")
      UNION ALL
      SELECT
        ARRAY[
          to_jsonb('table'::text),
          to_jsonb(${externalId}::text),
          to_jsonb('storage'::text),
          to_jsonb('rows'::text),
          to_jsonb(('seed-' || "n"::text)::text)
        ]::jsonb[],
        jsonb_build_object(
          'rowData',
          jsonb_build_object(
            'team',
            CASE
              WHEN "n" % 4 = 0 THEN 'null'::jsonb
              WHEN "n" % 4 = 1 THEN to_jsonb('alpha'::text)
              WHEN "n" % 4 = 2 THEN to_jsonb('beta'::text)
              ELSE to_jsonb('gamma'::text)
            END,
            'value',
            to_jsonb(("n" % 1000)::int)
          )
        )
      FROM generate_series(1, ${rowCount}) AS "n"
    `;
  }

  async function executeWorkload(
    fromTable: ReturnType<typeof declareStoredTable<{ value: number, team: string | null }>>,
    operations: WorkloadOperation[],
  ): Promise<void> {
    for (const operation of operations) {
      if (operation.type === "upsert") {
        await runStatements(fromTable.setRow(
          operation.rowIdentifier,
          expr(jsonbLiteral({ team: operation.team, value: operation.value })),
        ));
      } else {
        await runStatements(fromTable.deleteRow(operation.rowIdentifier));
      }
    }
  }

  async function benchmarkScenario(options: {
    name: string,
    warmupOperations: WorkloadOperation[],
    measuredOperations: WorkloadOperation[],
    beforeRun: () => Promise<{ fromTable: ReturnType<typeof declareStoredTable<{ value: number, team: string | null }>>, validate: () => Promise<void> }>,
  }) {
    const setup = await options.beforeRun();
    await executeWorkload(setup.fromTable, options.warmupOperations);
    const startedAt = performance.now();
    await executeWorkload(setup.fromTable, options.measuredOperations);
    const elapsedMs = performance.now() - startedAt;
    await setup.validate();

    const operationsPerSecond = options.measuredOperations.length / (elapsedMs / 1000);
    logLine(`[bulldozer-perf] ${options.name}: ${operationsPerSecond.toFixed(1)} ops/s (${options.measuredOperations.length} ops in ${elapsedMs.toFixed(1)} ms)`);
    return { operationsPerSecond, elapsedMs };
  }

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldQueue"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldMetadata"`;
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
    await sql`CREATE INDEX "BulldozerTimeFoldQueue_scheduledAt_idx" ON "BulldozerTimeFoldQueue"("scheduledAt")`;
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
  });

  afterEach(async () => {
    for (const table of allInitializedTables) {
      const errors = await readRows(table.verifyDataIntegrity());
      expect(errors).toEqual([]);
    }
    allInitializedTables.length = 0;
  });

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

  it("reports ops/sec for baseline and composed example setup", async () => {
    const warmupOperations = createWorkload(111, DEFAULT_WARMUP_OPS);
    const measuredOperations = createWorkload(222, DEFAULT_MEASURED_OPS);

    const baseline = await benchmarkScenario({
      name: "stored-table baseline",
      warmupOperations,
      measuredOperations,
      beforeRun: async () => {
        const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "perf-baseline-users" });
        await runStatements(fromTable.init());
        return {
          fromTable,
          validate: async () => {
            const rows = await readRows(fromTable.listRowsInGroup({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }));
            expect(Array.isArray(rows)).toBe(true);
          },
        };
      },
    });

    const composed = await benchmarkScenario({
      name: "group+map+group composed pipeline",
      warmupOperations,
      measuredOperations,
      beforeRun: async () => {
        const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "perf-composed-users" });
        const groupedByTeam = declareGroupByTable({
          tableId: "perf-composed-users-by-team",
          fromTable,
          groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
        });
        const mapped = declareMapTable({
          tableId: "perf-composed-users-mapped",
          fromTable: groupedByTeam,
          mapper: { type: "mapper", sql: `
            ("rowData"->'team') AS "team",
            (("rowData"->>'value')::int + 10) AS "valuePlusTen",
            (
              CASE
                WHEN (("rowData"->>'value')::int + 10) >= 40 THEN 'high'
                ELSE 'low'
              END
            ) AS "bucket"
          ` },
        });
        const groupedByBucket = declareGroupByTable({
          tableId: "perf-composed-users-by-bucket",
          fromTable: mapped,
          groupBy: { type: "mapper", sql: `"rowData"->'bucket' AS "groupKey"` },
        });

        await runStatements(fromTable.init());
        await runStatements(groupedByTeam.init());
        await runStatements(mapped.init());
        await runStatements(groupedByBucket.init());

        return {
          fromTable,
          validate: async () => {
            const rows = await readRows(groupedByBucket.listRowsInGroup({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }));
            expect(Array.isArray(rows)).toBe(true);
          },
        };
      },
    });

    const slowdownFactor = baseline.operationsPerSecond / composed.operationsPerSecond;
    logLine(`[bulldozer-perf] slowdown factor (baseline/composed): ${slowdownFactor.toFixed(2)}x`);
    logLine(`[bulldozer-perf] config: warmup=${DEFAULT_WARMUP_OPS}, measured=${DEFAULT_MEASURED_OPS}`);

    expect(baseline.operationsPerSecond).toBeGreaterThan(0);
    expect(composed.operationsPerSecond).toBeGreaterThan(0);
  });

  it("regression: stacked group-map-group mutations avoid the postgres JIT cliff", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "perf-regression-users" });
    const groupedByTeam = declareGroupByTable({
      tableId: "perf-regression-users-by-team",
      fromTable,
      groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
    });
    const mappedLevel1 = declareMapTable({
      tableId: "perf-regression-users-map-level-1",
      fromTable: groupedByTeam,
      mapper: { type: "mapper", sql: `
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 1) AS "value",
        (
          CASE
            WHEN ((("rowData"->>'value')::int + 1) % 2) = 0 THEN 'even'
            ELSE 'odd'
          END
        ) AS "bucket"
      ` },
    });
    const mappedLevel2 = declareMapTable({
      tableId: "perf-regression-users-map-level-2",
      fromTable: mappedLevel1,
      mapper: { type: "mapper", sql: `
        ("rowData"->'team') AS "team",
        ("rowData"->'bucket') AS "bucket",
        (("rowData"->>'value')::int * 3) AS "score"
      ` },
    });
    const groupedByBucket = declareGroupByTable({
      tableId: "perf-regression-users-by-bucket",
      fromTable: mappedLevel2,
      groupBy: { type: "mapper", sql: `"rowData"->'bucket' AS "groupKey"` },
    });

    await runStatements(fromTable.init());
    await runStatements(groupedByTeam.init());
    await runStatements(mappedLevel1.init());
    await runStatements(mappedLevel2.init());
    await runStatements(groupedByBucket.init());

    const seedRows = [
      ["u1", { team: "alpha", value: 5 }],
      ["u2", { team: "beta", value: 7 }],
      ["u3", { team: "gamma", value: 9 }],
      ["u:4", { team: "alpha", value: 11 }],
      ["u 5", { team: null, value: 13 }],
    ] as const;
    for (const [rowIdentifier, rowData] of seedRows) {
      await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
    }

    await runStatements(fromTable.setRow("u1", expr(jsonbLiteral({ team: "alpha", value: 15 }))));

    const setRowMutation = await measureMs("regression stacked pipeline setRow", async () => {
      await runStatements(fromTable.setRow("u2", expr(jsonbLiteral({ team: "beta", value: 19 }))));
    });
    expect(setRowMutation.elapsedMs).toBeLessThan(STACKED_MAP_PIPELINE_MUTATION_MAX_MS);

    const deleteMutation = await measureMs("regression stacked pipeline deleteRow", async () => {
      await runStatements(fromTable.deleteRow("u3"));
    });
    expect(deleteMutation.elapsedMs).toBeLessThan(STACKED_MAP_PIPELINE_MUTATION_MAX_MS);
  });

  it("regression: virtual concat queries stay fast after metadata-only initialization", async () => {
    const tableAId = "perf-concat-users-a";
    const tableBId = "perf-concat-users-b";
    const fromTableA = declareStoredTable<{ value: number, team: string | null }>({ tableId: tableAId });
    const fromTableB = declareStoredTable<{ value: number, team: string | null }>({ tableId: tableBId });
    const groupedByTeamA = declareGroupByTable({
      tableId: "perf-concat-users-a-by-team",
      fromTable: fromTableA,
      groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
    });
    const groupedByTeamB = declareGroupByTable({
      tableId: "perf-concat-users-b-by-team",
      fromTable: fromTableB,
      groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
    });
    const concatenatedByTeam = declareConcatTable({
      tableId: "perf-concat-users-by-team",
      tables: [groupedByTeamA, groupedByTeamB],
    });

    expect((await readRows(concatenatedByTeam.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })))).toEqual([]);

    await prefillStoredTableInSingleStatement(tableAId, VIRTUAL_CONCAT_LOAD_ROW_COUNT);
    await prefillStoredTableInSingleStatement(tableBId, VIRTUAL_CONCAT_LOAD_ROW_COUNT);
    await runStatements(groupedByTeamA.init());
    await runStatements(groupedByTeamB.init());
    await runStatements(concatenatedByTeam.init());
    expect(await readRows(concatenatedByTeam.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).not.toEqual([]);

    const concatenatedCountQuery = concatenatedByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const countRows = await measureMs("virtual concat count query", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(concatenatedCountQuery)}) AS "rows"
      `);
    });
    expect(countRows.elapsedMs).toBeLessThan(VIRTUAL_CONCAT_COUNT_QUERY_MAX_MS);
    expect(Number(countRows.result[0].count)).toBe(VIRTUAL_CONCAT_LOAD_ROW_COUNT * 2);
  });

  it.each(LOAD_ROW_COUNTS)("load test: prefilled stored table with hundreds of thousands of rows stays functional and fast (%i rows)", async (loadRowCount) => {
    const tableId = "load-prefilled-users";
    const externalTableId = `external:${tableId}`;
    const table = declareStoredTable<{ value: number, team: string | null }>({ tableId });

    const prefill = await measureMs(`load prefill (${loadRowCount} rows)`, async () => {
      await prefillStoredTableInSingleStatement(tableId, loadRowCount);
    });
    expect(prefill.elapsedMs).toBeLessThan(LOAD_PREFILL_MAX_MS);

    const metadataInitializedRows = await sql`
      SELECT EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ARRAY[
          to_jsonb('table'::text),
          to_jsonb(${externalTableId}::text),
          to_jsonb('storage'::text),
          to_jsonb('metadata'::text)
        ]::jsonb[]
      ) AS "initialized"
    `;
    expect(metadataInitializedRows[0].initialized).toBe(true);

    const listRowsQuery = table.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const countRows = await measureMs("load count via listRowsInGroup", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(listRowsQuery)}) AS "rows"
      `);
    });
    expect(countRows.elapsedMs).toBeLessThan(LOAD_COUNT_QUERY_MAX_MS);
    expect(Number(countRows.result[0].count)).toBe(loadRowCount);

    const setRowIterationTimes: number[] = [];
    for (let i = 0; i < LOAD_SET_ROW_AVG_ITERATIONS; i++) {
      const startedAt = performance.now();
      await runStatements(table.setRow(
        `seed-${Math.floor(loadRowCount / 2) + i}`,
        expr(jsonbLiteral({ team: "beta", value: 777 + i })),
      ));
      setRowIterationTimes.push(performance.now() - startedAt);
    }
    const setRowAverageMs = setRowIterationTimes.reduce((acc, value) => acc + value, 0) / setRowIterationTimes.length;
    logLine(`[bulldozer-perf] load setRow average (${LOAD_SET_ROW_AVG_ITERATIONS} iterations): ${setRowAverageMs.toFixed(1)} ms`);
    expect(setRowAverageMs).toBeLessThanOrEqual(LOAD_SET_ROW_AVG_MAX_MS);
    const onlineInsertTimes: number[] = [];
    const onlineUpdateTimes: number[] = [];
    const onlineDeleteTimes: number[] = [];
    for (let i = 0; i < LOAD_ONLINE_MUTATION_ITERATIONS; i++) {
      const rowIdentifier = `perf-online-row-${i}`;
      const insertStartedAt = performance.now();
      await runStatements(table.setRow(rowIdentifier, expr(jsonbLiteral({ team: "beta", value: 111 + i }))));
      onlineInsertTimes.push(performance.now() - insertStartedAt);
      const updateStartedAt = performance.now();
      await runStatements(table.setRow(rowIdentifier, expr(jsonbLiteral({ team: "beta", value: 211 + i }))));
      onlineUpdateTimes.push(performance.now() - updateStartedAt);
      const deleteStartedAt = performance.now();
      await runStatements(table.deleteRow(rowIdentifier));
      onlineDeleteTimes.push(performance.now() - deleteStartedAt);
    }
    const onlineInsertAvgMs = onlineInsertTimes.reduce((acc, value) => acc + value, 0) / onlineInsertTimes.length;
    const onlineUpdateAvgMs = onlineUpdateTimes.reduce((acc, value) => acc + value, 0) / onlineUpdateTimes.length;
    const onlineDeleteAvgMs = onlineDeleteTimes.reduce((acc, value) => acc + value, 0) / onlineDeleteTimes.length;
    logLine(`[bulldozer-perf] load online setRow insert average (${LOAD_ONLINE_MUTATION_ITERATIONS} iterations): ${onlineInsertAvgMs.toFixed(1)} ms`);
    logLine(`[bulldozer-perf] load online setRow update average (${LOAD_ONLINE_MUTATION_ITERATIONS} iterations): ${onlineUpdateAvgMs.toFixed(1)} ms`);
    logLine(`[bulldozer-perf] load online deleteRow average (${LOAD_ONLINE_MUTATION_ITERATIONS} iterations): ${onlineDeleteAvgMs.toFixed(1)} ms`);
    expect(onlineInsertAvgMs).toBeLessThanOrEqual(LOAD_ONLINE_MUTATION_MAX_MS);
    expect(onlineUpdateAvgMs).toBeLessThanOrEqual(LOAD_ONLINE_MUTATION_MAX_MS);
    expect(onlineDeleteAvgMs).toBeLessThanOrEqual(LOAD_ONLINE_MUTATION_MAX_MS);

    const pointDelete = await measureMs("load point delete (deleteRow existing)", async () => {
      await runStatements(table.deleteRow(`seed-${Math.floor(loadRowCount / 2) - 1}`));
    });
    expect(pointDelete.elapsedMs).toBeLessThan(LOAD_POINT_MUTATION_MAX_MS);

    const countAfterDelete = await sql.unsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM (${toQueryableSqlQuery(listRowsQuery)}) AS "rows"
    `);
    expect(Number(countAfterDelete[0].count)).toBe(loadRowCount - 1);

    const groupedByTeam = declareGroupByTable({
      tableId: "load-prefilled-users-by-team",
      fromTable: table,
      groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
    });
    const leftJoinRulesTable = declareStoredTable<{ team: string | null, threshold: number, label: string }>({
      tableId: "load-prefilled-users-left-join-rules",
    });
    const leftJoinRulesByTeam = declareGroupByTable({
      tableId: "load-prefilled-users-left-join-rules-by-team",
      fromTable: leftJoinRulesTable,
      groupBy: { type: "mapper", sql: `"rowData"->'team' AS "groupKey"` },
    });
    const mappedByTeam = declareMapTable({
      tableId: "load-prefilled-users-mapped",
      fromTable: groupedByTeam,
      mapper: { type: "mapper", sql: `
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 10) AS "valuePlusTen",
        (
          CASE
            WHEN (("rowData"->>'value')::int + 10) >= 700 THEN 'high'
            ELSE 'low'
          END
        ) AS "bucket"
      ` },
    });
    const mappedTwice = declareMapTable({
      tableId: "load-prefilled-users-mapped-twice",
      fromTable: mappedByTeam,
      mapper: { type: "mapper", sql: `
        ("rowData"->'team') AS "team",
        ("rowData"->'bucket') AS "bucket",
        ((("rowData"->>'valuePlusTen')::int * 2)) AS "valueScaled"
      ` },
    });
    const groupedByBucket = declareGroupByTable({
      tableId: "load-prefilled-users-by-bucket",
      fromTable: mappedTwice,
      groupBy: { type: "mapper", sql: `"rowData"->'bucket' AS "groupKey"` },
    });
    const filteredHighValue = declareFilterTable({
      tableId: "load-prefilled-users-high-value",
      fromTable: groupedByTeam,
      filter: { type: "predicate", sql: `( ("rowData"->>'value')::int ) >= 700` },
    });
    const concatenatedByTeam = declareConcatTable({
      tableId: "load-prefilled-users-concat",
      tables: [groupedByTeam, filteredHighValue],
    });
    const limitedByTeam = declareLimitTable({
      tableId: "load-prefilled-users-top-team-rows",
      fromTable: groupedByTeam,
      limit: expr(`25`),
    });
    const leftJoinedTopByTeam = declareLeftJoinTable({
      tableId: "load-prefilled-users-left-join-top-team-rows",
      leftTable: limitedByTeam,
      rightTable: leftJoinRulesByTeam,
      leftJoinKey: { type: "mapper", sql: `(("rowData"->>'value')::int) AS "joinKey"` },
      rightJoinKey: { type: "mapper", sql: `(("rowData"->>'threshold')::int) AS "joinKey"` },
    });
    const expandedByTeam = declareFlatMapTable({
      tableId: "load-prefilled-users-expanded",
      fromTable: groupedByTeam,
      mapper: { type: "mapper", sql: `
        jsonb_build_array(
          jsonb_build_object(
            'team', "rowData"->'team',
            'kind', 'base',
            'mappedValue', (("rowData"->>'value')::int + 10)
          ),
          jsonb_build_object(
            'team', "rowData"->'team',
            'kind', 'double',
            'mappedValue', (("rowData"->>'value')::int * 2)
          )
        ) AS "rows"
      ` },
    });

    await runStatements(leftJoinRulesTable.init());
    await runStatements(leftJoinRulesTable.setRow("rule-alpha", expr(jsonbLiteral({ team: "alpha", threshold: 0, label: "alpha-rule" }))));
    await runStatements(leftJoinRulesTable.setRow("rule-beta", expr(jsonbLiteral({ team: "beta", threshold: 0, label: "beta-rule" }))));
    await runStatements(leftJoinRulesTable.setRow("rule-gamma", expr(jsonbLiteral({ team: "gamma", threshold: 0, label: "gamma-rule" }))));
    await runStatements(leftJoinRulesTable.setRow("rule-null", expr(jsonbLiteral({ team: null, threshold: 0, label: "null-rule" }))));
    const leftJoinRulesInit = await measureMs("load init leftJoinRulesByTeam", async () => {
      await runStatements(leftJoinRulesByTeam.init());
    });
    expect(leftJoinRulesInit.elapsedMs).toBeLessThan(LOAD_DERIVED_INIT_MAX_MS);

    const groupInit = await measureMs("load init groupedByTeam", async () => {
      await runStatements(groupedByTeam.init());
    });
    expect(groupInit.elapsedMs).toBeLessThan(LOAD_DERIVED_INIT_MAX_MS);
    const mapInit = await measureMs("load init mappedByTeam", async () => {
      await runStatements(mappedByTeam.init());
    });
    expect(mapInit.elapsedMs).toBeLessThan(LOAD_DERIVED_INIT_MAX_MS);
    const mapTwiceInit = await measureMs("load init mappedTwice", async () => {
      await runStatements(mappedTwice.init());
    });
    expect(mapTwiceInit.elapsedMs).toBeLessThan(LOAD_DERIVED_INIT_MAX_MS);
    const bucketInit = await measureMs("load init groupedByBucket", async () => {
      await runStatements(groupedByBucket.init());
    });
    expect(bucketInit.elapsedMs).toBeLessThan(LOAD_DERIVED_INIT_MAX_MS);
    const filterInit = await measureMs("load init filteredHighValue", async () => {
      await runStatements(filteredHighValue.init());
    });
    expect(filterInit.elapsedMs).toBeLessThan(LOAD_FILTER_TABLE_INIT_MAX_MS);
    const concatInit = await measureMs("load init concatenatedByTeam", async () => {
      await runStatements(concatenatedByTeam.init());
    });
    expect(concatInit.elapsedMs).toBeLessThan(LOAD_CONCAT_TABLE_INIT_MAX_MS);
    const limitInit = await measureMs("load init limitedByTeam", async () => {
      await runStatements(limitedByTeam.init());
    });
    expect(limitInit.elapsedMs).toBeLessThan(LOAD_LIMIT_TABLE_INIT_MAX_MS);
    const expandInit = await measureMs("load init expandedByTeam", async () => {
      await runStatements(expandedByTeam.init());
    });
    expect(expandInit.elapsedMs).toBeLessThan(LOAD_EXPANDING_INIT_MAX_MS);

    const groupedCountQuery = groupedByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const mappedCountQuery = mappedTwice.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const bucketCountQuery = groupedByBucket.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const expandedCountQuery = expandedByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const filteredHighValueCountQuery = filteredHighValue.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const concatenatedByTeamCountQuery = concatenatedByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const limitedByTeamCountQuery = limitedByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const derivedCounts = await measureMs("load count derived tables", async () => {
      return await Promise.all([
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(groupedCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(mappedCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(bucketCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(filteredHighValueCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(concatenatedByTeamCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(limitedByTeamCountQuery)}) AS "rows"`),
        sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM (${toQueryableSqlQuery(expandedCountQuery)}) AS "rows"`),
      ]);
    });
    expect(derivedCounts.elapsedMs).toBeLessThan(LOAD_DERIVED_COUNT_QUERY_MAX_MS);
    expect(Number(derivedCounts.result[0][0].count)).toBe(loadRowCount - 1);
    expect(Number(derivedCounts.result[1][0].count)).toBe(loadRowCount - 1);
    expect(Number(derivedCounts.result[2][0].count)).toBe(loadRowCount - 1);
    expect(Number(derivedCounts.result[3][0].count)).toBeGreaterThan(0);
    expect(Number(derivedCounts.result[3][0].count)).toBeLessThan(loadRowCount);
    expect(Number(derivedCounts.result[4][0].count)).toBeGreaterThan(loadRowCount - 1);
    expect(Number(derivedCounts.result[4][0].count)).toBeLessThan((loadRowCount - 1) * 2);
    expect(Number(derivedCounts.result[5][0].count)).toBeGreaterThan(0);
    expect(Number(derivedCounts.result[5][0].count)).toBeLessThanOrEqual(100);
    expect(Number(derivedCounts.result[6][0].count)).toBe((loadRowCount - 1) * 2);

    const filteredHighValueCountOnly = await measureMs("load count filteredHighValue table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(filteredHighValueCountQuery)}) AS "rows"
      `);
    });
    expect(filteredHighValueCountOnly.elapsedMs).toBeLessThan(LOAD_FILTER_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(filteredHighValueCountOnly.result[0].count)).toBeGreaterThan(0);

    const concatenatedByTeamCountOnly = await measureMs("load count concatenatedByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(concatenatedByTeamCountQuery)}) AS "rows"
      `);
    });
    expect(concatenatedByTeamCountOnly.elapsedMs).toBeLessThan(LOAD_CONCAT_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(concatenatedByTeamCountOnly.result[0].count)).toBeGreaterThan(loadRowCount - 1);
    expect(Number(concatenatedByTeamCountOnly.result[0].count)).toBeLessThan((loadRowCount - 1) * 2);

    const limitedByTeamCountOnly = await measureMs("load count limitedByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(limitedByTeamCountQuery)}) AS "rows"
      `);
    });
    expect(limitedByTeamCountOnly.elapsedMs).toBeLessThan(LOAD_LIMIT_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(limitedByTeamCountOnly.result[0].count)).toBeGreaterThan(0);
    expect(Number(limitedByTeamCountOnly.result[0].count)).toBeLessThanOrEqual(100);

    const expandedCountOnly = await measureMs("load count expanded table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(expandedCountQuery)}) AS "rows"
      `);
    });
    expect(expandedCountOnly.elapsedMs).toBeLessThan(LOAD_EXPANDING_COUNT_QUERY_MAX_MS);
    expect(Number(expandedCountOnly.result[0].count)).toBe((loadRowCount - 1) * 2);

    const filteredExpandedBetaBase = await measureMs("load filtered expanded query (team=beta, kind=base)", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (
          ${toQueryableSqlQuery(expandedByTeam.listRowsInGroup({
            groupKey: expr(`to_jsonb('beta'::text)`),
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }))}
        ) AS "rows"
        WHERE "rows"."rowdata"->>'kind' = 'base'
      `);
    });
    expect(filteredExpandedBetaBase.elapsedMs).toBeLessThan(LOAD_FILTERED_QUERY_MAX_MS);
    expect(Number(filteredExpandedBetaBase.result[0].count)).toBeGreaterThan(0);

    await runStatements(table.setRow(
      "seed-100000",
      expr(jsonbLiteral({ team: "delta", value: 999 })),
    ));
    const deltaGroupedRows = await readRows(groupedByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(deltaGroupedRows.some((row) => row.rowidentifier === "seed-100000")).toBe(true);
    const highBucketRows = await readRows(groupedByBucket.listRowsInGroup({
      groupKey: expr(`to_jsonb('high'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const highBucketRow = highBucketRows.find((row) => row.rowidentifier === "seed-100000:1:1");
    expect(highBucketRow).toBeDefined();
    expect(highBucketRow?.rowdata).toEqual({
      team: "delta",
      bucket: "high",
      valueScaled: 2018,
    });
    const expandedDeltaRows = await readRows(expandedByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(expandedDeltaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(String(a.rowIdentifier), String(b.rowIdentifier)))).toEqual([
      { rowIdentifier: "seed-100000:1", rowData: { team: "delta", kind: "base", mappedValue: 1009 } },
      { rowIdentifier: "seed-100000:2", rowData: { team: "delta", kind: "double", mappedValue: 1998 } },
    ]);
    const filteredDeltaRows = await readRows(filteredHighValue.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(filteredDeltaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "seed-100000:1", rowData: { team: "delta", value: 999 } },
    ]);
    const groupedSubsetSql = `
      SELECT *
      FROM (${toQueryableSqlQuery(groupedByTeam.listRowsInGroup({
        groupKey: expr(`to_jsonb('beta'::text)`),
        start: "start",
        end: "end",
        startInclusive: true,
        endInclusive: true,
      }))}) AS "rows"
      LIMIT ${LOAD_SUBSET_ITERATION_ROW_COUNT}
    `;
    // Warm once so we measure steady-state subset iteration instead of first-touch planner/cache cost.
    await sql.unsafe(groupedSubsetSql);
    const groupedSubsetSamplesMs: number[] = [];
    for (let runIndex = 0; runIndex < LOAD_SUBSET_ITERATION_MEASURED_RUNS; runIndex++) {
      const groupedSubsetRun = await measureMs(`load iterate groupedByTeam subset from start (${LOAD_SUBSET_ITERATION_ROW_COUNT} rows) run ${runIndex + 1}/${LOAD_SUBSET_ITERATION_MEASURED_RUNS}`, async () => {
        return await sql.unsafe(groupedSubsetSql);
      });
      groupedSubsetSamplesMs.push(groupedSubsetRun.elapsedMs);
      expect(groupedSubsetRun.result).toHaveLength(LOAD_SUBSET_ITERATION_ROW_COUNT);
    }
    const groupedSubsetStats = summarizeMs(groupedSubsetSamplesMs);
    logLine(
      `[bulldozer-perf] load iterate groupedByTeam subset stats (${LOAD_SUBSET_ITERATION_MEASURED_RUNS} runs): `
      + `avg=${groupedSubsetStats.averageMs.toFixed(1)} ms, `
      + `trimmedAvg=${groupedSubsetStats.trimmedAverageMs.toFixed(1)} ms, `
      + `median=${groupedSubsetStats.medianMs.toFixed(1)} ms, `
      + `stddev=${groupedSubsetStats.stdDevMs.toFixed(1)} ms, `
      + `variance=${groupedSubsetStats.varianceMs2.toFixed(1)} ms^2, `
      + `min=${groupedSubsetStats.minMs.toFixed(1)} ms, `
      + `max=${groupedSubsetStats.maxMs.toFixed(1)} ms`
    );
    expect(groupedSubsetStats.trimmedAverageMs).toBeLessThanOrEqual(LOAD_SUBSET_ITERATION_MAX_MS);
    const sortedHighValueByTeam = declareSortTable({
      tableId: "load-prefilled-users-high-value-sorted",
      fromTable: filteredHighValue,
      getSortKey: { type: "mapper", sql: `( ("rowData"->>'value')::int ) AS "newSortKey"` },
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    const foldedHighValueByTeam = declareLFoldTable({
      tableId: "load-prefilled-users-high-value-folded",
      fromTable: sortedHighValueByTeam,
      initialState: expr(`'0'::jsonb`),
      reducer: { type: "mapper", sql: `
        (
          COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)
        ) AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'team', "oldRowData"->'team',
            'value', (("oldRowData"->>'value')::int),
            'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)
          )
        ) AS "newRowsData"
      ` },
    });
    const timedExposureByTeam = declareTimeFoldTable({
      tableId: "load-prefilled-users-timefold",
      fromTable: groupedByTeam,
      initialState: expr(`'0'::jsonb`),
      reducer: { type: "mapper", sql: `
        (("oldRowData"->>'value')::int) AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'team', "oldRowData"->'team',
            'value', (("oldRowData"->>'value')::int),
            'timestamp',
              CASE
                WHEN "timestamp" IS NULL THEN 'null'::jsonb
                ELSE to_jsonb("timestamp")
              END
          )
        ) AS "newRowsData",
        CASE
          WHEN "timestamp" IS NULL THEN (now() + interval '15 minutes')
          ELSE NULL::timestamptz
        END AS "nextTimestamp"
      ` },
    });
    const sortInit = await measureMs("load init sortedHighValueByTeam", async () => {
      await runStatements(sortedHighValueByTeam.init());
    });
    expect(sortInit.elapsedMs).toBeLessThan(LOAD_SORT_TABLE_INIT_MAX_MS);
    const approxRowsPerValuePerTeam = Math.max(1, Math.floor(loadRowCount / 4 / 1000));
    const sortedSubsetRequiredSortKeySpan = Math.ceil(LOAD_SUBSET_ITERATION_ROW_COUNT / approxRowsPerValuePerTeam);
    const sortedSubsetFromStartMaxSortKey = Math.min(999, 699 + sortedSubsetRequiredSortKeySpan);
    const sortedSubsetFromCursorMinSortKey = Math.max(700, 1000 - sortedSubsetRequiredSortKeySpan);
    const sortedSubsetFromStartSql = `
      SELECT *
      FROM (${toQueryableSqlQuery(sortedHighValueByTeam.listRowsInGroup({
        groupKey: expr(`to_jsonb('beta'::text)`),
        start: "start",
        end: expr(`to_jsonb(${sortedSubsetFromStartMaxSortKey}::int)`),
        startInclusive: true,
        endInclusive: true,
      }))}) AS "rows"
      LIMIT ${LOAD_SUBSET_ITERATION_ROW_COUNT}
    `;
    await sql.unsafe(sortedSubsetFromStartSql);
    const sortedSubsetFromStartSamplesMs: number[] = [];
    for (let runIndex = 0; runIndex < LOAD_SUBSET_ITERATION_MEASURED_RUNS; runIndex++) {
      const sortedSubsetFromStartRun = await measureMs(`load iterate sortedHighValueByTeam subset from start (${LOAD_SUBSET_ITERATION_ROW_COUNT} rows) run ${runIndex + 1}/${LOAD_SUBSET_ITERATION_MEASURED_RUNS}`, async () => {
        return await sql.unsafe(sortedSubsetFromStartSql);
      });
      sortedSubsetFromStartSamplesMs.push(sortedSubsetFromStartRun.elapsedMs);
      expect(sortedSubsetFromStartRun.result).toHaveLength(LOAD_SUBSET_ITERATION_ROW_COUNT);
    }
    const sortedSubsetFromStartStats = summarizeMs(sortedSubsetFromStartSamplesMs);
    logLine(
      `[bulldozer-perf] load iterate sortedHighValueByTeam subset from start stats (${LOAD_SUBSET_ITERATION_MEASURED_RUNS} runs): `
      + `avg=${sortedSubsetFromStartStats.averageMs.toFixed(1)} ms, `
      + `trimmedAvg=${sortedSubsetFromStartStats.trimmedAverageMs.toFixed(1)} ms, `
      + `median=${sortedSubsetFromStartStats.medianMs.toFixed(1)} ms, `
      + `stddev=${sortedSubsetFromStartStats.stdDevMs.toFixed(1)} ms, `
      + `variance=${sortedSubsetFromStartStats.varianceMs2.toFixed(1)} ms^2, `
      + `min=${sortedSubsetFromStartStats.minMs.toFixed(1)} ms, `
      + `max=${sortedSubsetFromStartStats.maxMs.toFixed(1)} ms`
    );
    expect(sortedSubsetFromStartStats.trimmedAverageMs).toBeLessThanOrEqual(LOAD_SUBSET_ITERATION_MAX_MS);
    const sortedSubsetFromSortKeySql = `
      SELECT *
      FROM (${toQueryableSqlQuery(sortedHighValueByTeam.listRowsInGroup({
        groupKey: expr(`to_jsonb('beta'::text)`),
        start: expr(`to_jsonb(${sortedSubsetFromCursorMinSortKey}::int)`),
        end: expr(`to_jsonb(999::int)`),
        startInclusive: true,
        endInclusive: true,
      }))}) AS "rows"
      LIMIT ${LOAD_SUBSET_ITERATION_ROW_COUNT}
    `;
    await sql.unsafe(sortedSubsetFromSortKeySql);
    const sortedSubsetFromSortKeySamplesMs: number[] = [];
    for (let runIndex = 0; runIndex < LOAD_SUBSET_ITERATION_MEASURED_RUNS; runIndex++) {
      const sortedSubsetFromSortKeyRun = await measureMs(`load iterate sortedHighValueByTeam subset from sort-key cursor (${LOAD_SUBSET_ITERATION_ROW_COUNT} rows) run ${runIndex + 1}/${LOAD_SUBSET_ITERATION_MEASURED_RUNS}`, async () => {
        return await sql.unsafe(sortedSubsetFromSortKeySql);
      });
      sortedSubsetFromSortKeySamplesMs.push(sortedSubsetFromSortKeyRun.elapsedMs);
      expect(sortedSubsetFromSortKeyRun.result).toHaveLength(LOAD_SUBSET_ITERATION_ROW_COUNT);
    }
    const sortedSubsetFromSortKeyStats = summarizeMs(sortedSubsetFromSortKeySamplesMs);
    logLine(
      `[bulldozer-perf] load iterate sortedHighValueByTeam subset from sort-key cursor stats (${LOAD_SUBSET_ITERATION_MEASURED_RUNS} runs): `
      + `avg=${sortedSubsetFromSortKeyStats.averageMs.toFixed(1)} ms, `
      + `trimmedAvg=${sortedSubsetFromSortKeyStats.trimmedAverageMs.toFixed(1)} ms, `
      + `median=${sortedSubsetFromSortKeyStats.medianMs.toFixed(1)} ms, `
      + `stddev=${sortedSubsetFromSortKeyStats.stdDevMs.toFixed(1)} ms, `
      + `variance=${sortedSubsetFromSortKeyStats.varianceMs2.toFixed(1)} ms^2, `
      + `min=${sortedSubsetFromSortKeyStats.minMs.toFixed(1)} ms, `
      + `max=${sortedSubsetFromSortKeyStats.maxMs.toFixed(1)} ms`
    );
    expect(sortedSubsetFromSortKeyStats.trimmedAverageMs).toBeLessThanOrEqual(LOAD_SUBSET_ITERATION_MAX_MS);
    const lFoldInit = await measureMs("load init foldedHighValueByTeam", async () => {
      await runStatements(foldedHighValueByTeam.init());
    });
    expect(lFoldInit.elapsedMs).toBeLessThan(LOAD_LFOLD_TABLE_INIT_MAX_MS);
    const timeFoldInit = await measureMs("load init timedExposureByTeam", async () => {
      await runStatements(timedExposureByTeam.init());
    });
    expect(timeFoldInit.elapsedMs).toBeLessThan(LOAD_TIMEFOLD_TABLE_INIT_MAX_MS);
    const sortedDeltaRows = await readRows(sortedHighValueByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(sortedDeltaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowSortKey: row.rowsortkey, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "seed-100000:1", rowSortKey: 999, rowData: { team: "delta", value: 999 } },
    ]);
    const foldedDeltaRows = await readRows(foldedHighValueByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(foldedDeltaRows).toHaveLength(1);
    expect(foldedDeltaRows[0].rowidentifier).toBe("seed-100000:1:1");
    expect(foldedDeltaRows[0].rowdata).toEqual({
      team: "delta",
      value: 999,
      runningTotal: 999,
    });
    const timedExposureDeltaRows = await readRows(timedExposureByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(timedExposureDeltaRows).toHaveLength(1);
    expect(timedExposureDeltaRows[0].rowidentifier).toBe("seed-100000:1");
    expect(timedExposureDeltaRows[0].rowdata).toEqual({
      team: "delta",
      value: 999,
      timestamp: null,
    });
    const foldedHighValueCountOnly = await measureMs("load count foldedHighValueByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(foldedHighValueByTeam.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }))}) AS "rows"
      `);
    });
    expect(foldedHighValueCountOnly.elapsedMs).toBeLessThan(LOAD_LFOLD_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(foldedHighValueCountOnly.result[0].count)).toBeGreaterThan(0);
    expect(Number(foldedHighValueCountOnly.result[0].count)).toBeLessThanOrEqual(Number(filteredHighValueCountOnly.result[0].count) + 1);
    const timedExposureCountOnly = await measureMs("load count timedExposureByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(timedExposureByTeam.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }))}) AS "rows"
      `);
    });
    expect(timedExposureCountOnly.elapsedMs).toBeLessThan(LOAD_TIMEFOLD_TABLE_COUNT_QUERY_MAX_MS);
    const expectedTimedExposureCount = loadRowCount >= 100_000
      ? (loadRowCount - 1)
      : loadRowCount;
    expect(Number(timedExposureCountOnly.result[0].count)).toBe(expectedTimedExposureCount);
    const concatenatedDeltaRows = await readRows(concatenatedByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(concatenatedDeltaRows
      .map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier)))
      .toEqual([
        { rowIdentifier: "0:seed-100000", rowData: { team: "delta", value: 999 } },
        { rowIdentifier: "1:seed-100000:1", rowData: { team: "delta", value: 999 } },
      ]);
    const limitedDeltaRows = await readRows(limitedByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(limitedDeltaRows).toHaveLength(1);
    expect(limitedDeltaRows[0].rowidentifier).toBe("seed-100000");
    const leftJoinInit = await measureMs("load init leftJoinedTopByTeam", async () => {
      await runStatements(leftJoinedTopByTeam.init());
    });
    expect(leftJoinInit.elapsedMs).toBeLessThan(LOAD_LEFT_JOIN_TABLE_INIT_MAX_MS);
    const leftJoinedTopByTeamCountQuery = leftJoinedTopByTeam.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    });
    const leftJoinedTopByTeamCountOnly = await measureMs("load count leftJoinedTopByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(leftJoinedTopByTeamCountQuery)}) AS "rows"
      `);
    });
    expect(leftJoinedTopByTeamCountOnly.elapsedMs).toBeLessThan(LOAD_LEFT_JOIN_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(leftJoinedTopByTeamCountOnly.result[0].count)).toBe(Number(limitedByTeamCountOnly.result[0].count) + 1);
    const leftJoinedDeltaRows = await readRows(leftJoinedTopByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(leftJoinedDeltaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      {
        rowIdentifier: `["seed-100000", null]`,
        rowData: {
          leftRowData: { team: "delta", value: 999 },
          rightRowData: null,
        },
      },
    ]);
    // CompactTable perf: use filteredHighValue as entries, limitedByTeam as boundaries
    // Both are grouped by team and already init'd. We need sorted versions.
    const compactEntriesSorted = declareSortTable({
      tableId: "load-prefilled-compact-entries-sorted",
      fromTable: filteredHighValue,
      getSortKey: { type: "mapper", sql: `(("rowData"->>'value')::numeric) AS "newSortKey"` },
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    const compactBoundariesSorted = declareSortTable({
      tableId: "load-prefilled-compact-boundaries-sorted",
      fromTable: limitedByTeam,
      getSortKey: { type: "mapper", sql: `(("rowData"->>'value')::numeric) AS "newSortKey"` },
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    await runStatements(compactEntriesSorted.init());
    await runStatements(compactBoundariesSorted.init());
    const compactedByTeam = declareCompactTable({
      tableId: "load-prefilled-compacted-by-team",
      toBeCompactedTable: compactEntriesSorted,
      boundaryTable: compactBoundariesSorted,
      orderingKey: "value",
      compactKey: "value",
      partitionKey: "team",
    });
    const compactInit = await measureMs("load init compactedByTeam", async () => {
      await runStatements(compactedByTeam.init());
    });
    expect(compactInit.elapsedMs).toBeLessThan(LOAD_COMPACT_TABLE_INIT_MAX_MS);
    const compactedCountOnly = await measureMs("load count compactedByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(compactedByTeam.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }))}) AS "rows"
      `);
    });
    expect(compactedCountOnly.elapsedMs).toBeLessThan(LOAD_COMPACT_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(compactedCountOnly.result[0].count)).toBeGreaterThan(0);

    // ReduceTable perf: reduce the grouped table into one row per team.
    // Skip for large row counts -- WITH RECURSIVE is O(N) per group with
    // high constant factor, making it impractical for 50K+ rows per group.
    // Our payments use case has small groups (few expiries per change entry).
    const reducedByTeam = declareReduceTable({
      tableId: "load-prefilled-reduced-by-team",
      fromTable: groupedByTeam,
      initialState: expr(`'0'::jsonb`),
      reducer: { type: "mapper", sql: `
        to_jsonb(
          COALESCE(("oldState" #>> '{}')::numeric, 0)
          + COALESCE(("oldRowData"->>'value')::numeric, 0)
        ) AS "newState"
      ` },
      finalize: { type: "mapper", sql: `
        "groupKey" AS "team",
        ("state" #>> '{}')::numeric AS "total"
      ` },
    });
    const reduceInit = await measureMs("load init reducedByTeam", async () => {
      await runStatements(reducedByTeam.init());
    });
    expect(reduceInit.elapsedMs).toBeLessThan(LOAD_REDUCE_TABLE_INIT_MAX_MS);
    const reducedCountOnly = await measureMs("load count reducedByTeam table only", async () => {
      return await sql.unsafe(`
        SELECT COUNT(*)::int AS "count"
        FROM (${toQueryableSqlQuery(reducedByTeam.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }))}) AS "rows"
      `);
    });
    expect(reducedCountOnly.elapsedMs).toBeLessThan(LOAD_REDUCE_TABLE_COUNT_QUERY_MAX_MS);
    expect(Number(reducedCountOnly.result[0].count)).toBeGreaterThan(0);
    expect(Number(reducedCountOnly.result[0].count)).toBeLessThanOrEqual(5);

    const bulkDelete = await measureMs("load full table delete", async () => {
      await runStatements(table.delete());
    });
    expect(bulkDelete.elapsedMs).toBeLessThan(LOAD_TABLE_DELETE_MAX_MS);

    const isInitializedRows = await sql`
      SELECT EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ARRAY[
          to_jsonb('table'::text),
          to_jsonb(${externalTableId}::text),
          to_jsonb('storage'::text),
          to_jsonb('metadata'::text)
        ]::jsonb[]
      ) AS "initialized"
    `;
    expect(isInitializedRows[0].initialized).toBe(false);

    logLine(`[bulldozer-perf] load thresholds(ms): prefill<=${LOAD_PREFILL_MAX_MS}, baseCount<=${LOAD_COUNT_QUERY_MAX_MS}, setRowAvg<=${LOAD_SET_ROW_AVG_MAX_MS} over ${LOAD_SET_ROW_AVG_ITERATIONS}, pointDelete<=${LOAD_POINT_MUTATION_MAX_MS}, onlineMutationAvg<=${LOAD_ONLINE_MUTATION_MAX_MS} over ${LOAD_ONLINE_MUTATION_ITERATIONS}, groupedSubsetTrimmedAvg<=${LOAD_SUBSET_ITERATION_MAX_MS} for ${LOAD_SUBSET_ITERATION_ROW_COUNT} rows over ${LOAD_SUBSET_ITERATION_MEASURED_RUNS} runs, derivedInit<=${LOAD_DERIVED_INIT_MAX_MS}, filterInit<=${LOAD_FILTER_TABLE_INIT_MAX_MS}, sortInit<=${LOAD_SORT_TABLE_INIT_MAX_MS}, lfoldInit<=${LOAD_LFOLD_TABLE_INIT_MAX_MS}, timefoldInit<=${LOAD_TIMEFOLD_TABLE_INIT_MAX_MS}, leftJoinInit<=${LOAD_LEFT_JOIN_TABLE_INIT_MAX_MS}, concatInit<=${LOAD_CONCAT_TABLE_INIT_MAX_MS}, limitInit<=${LOAD_LIMIT_TABLE_INIT_MAX_MS}, expandingInit<=${LOAD_EXPANDING_INIT_MAX_MS}, derivedCount<=${LOAD_DERIVED_COUNT_QUERY_MAX_MS}, filterCount<=${LOAD_FILTER_TABLE_COUNT_QUERY_MAX_MS}, lfoldCount<=${LOAD_LFOLD_TABLE_COUNT_QUERY_MAX_MS}, timefoldCount<=${LOAD_TIMEFOLD_TABLE_COUNT_QUERY_MAX_MS}, leftJoinCount<=${LOAD_LEFT_JOIN_TABLE_COUNT_QUERY_MAX_MS}, concatCount<=${LOAD_CONCAT_TABLE_COUNT_QUERY_MAX_MS}, limitCount<=${LOAD_LIMIT_TABLE_COUNT_QUERY_MAX_MS}, expandingCount<=${LOAD_EXPANDING_COUNT_QUERY_MAX_MS}, filteredQuery<=${LOAD_FILTERED_QUERY_MAX_MS}, tableDelete<=${LOAD_TABLE_DELETE_MAX_MS}`);
  }, 300_000);
});

