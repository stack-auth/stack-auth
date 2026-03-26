import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declareConcatTable, declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLimitTable, declareMapTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

type TestDb = { full: string, base: string };
type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };

type WorkloadOperation =
  | { type: "upsert", rowIdentifier: string, team: string | null, value: number }
  | { type: "delete", rowIdentifier: string };

const TEST_DB_PREFIX = "stack_bulldozer_db_perf_test";
const DEFAULT_WARMUP_OPS = 80;
const DEFAULT_MEASURED_OPS = 500;
const IS_CI = (() => {
  const env = Reflect.get(import.meta, "env");
  const ci = Reflect.get(env, "CI");
  const cursorAgent = Reflect.get(env, "CURSOR_AGENT");
  return (ci === true || ci === "true" || ci === "1") && (cursorAgent !== true && cursorAgent !== 'true' && cursorAgent !== "1");
})();
const DEFAULT_LOAD_ROW_COUNT = IS_CI ? 200_000 : 20_000;
const LOAD_PREFILL_MAX_MS = 30_000;
const LOAD_COUNT_QUERY_MAX_MS = 5_000;
const LOAD_POINT_MUTATION_MAX_MS = 400;
const LOAD_SET_ROW_AVG_ITERATIONS = 10;
const LOAD_SET_ROW_AVG_MAX_MS = 50;
const LOAD_TABLE_DELETE_MAX_MS = 20_000;
const LOAD_DERIVED_INIT_MAX_MS = 90_000;
const LOAD_DERIVED_COUNT_QUERY_MAX_MS = 10_000;
const LOAD_EXPANDING_INIT_MAX_MS = 120_000;
const LOAD_EXPANDING_COUNT_QUERY_MAX_MS = 15_000;
const LOAD_FILTERED_QUERY_MAX_MS = 4_000;
const LOAD_FILTER_TABLE_INIT_MAX_MS = 90_000;
const LOAD_FILTER_TABLE_COUNT_QUERY_MAX_MS = 8_000;
const LOAD_LIMIT_TABLE_INIT_MAX_MS = 90_000;
const LOAD_LIMIT_TABLE_COUNT_QUERY_MAX_MS = 8_000;
const LOAD_CONCAT_TABLE_INIT_MAX_MS = 10_000;
const LOAD_CONCAT_TABLE_COUNT_QUERY_MAX_MS = 8_000;
const STACKED_MAP_PIPELINE_MUTATION_MAX_MS = 400;
const VIRTUAL_CONCAT_COUNT_QUERY_MAX_MS = 500;
const VIRTUAL_CONCAT_LOAD_ROW_COUNT = 5_000;

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

  async function measureMs<T>(label: string, fn: () => Promise<T>): Promise<{ result: T, elapsedMs: number }> {
    const startedAt = performance.now();
    const result = await fn();
    const elapsedMs = performance.now() - startedAt;
    logLine(`[bulldozer-perf] ${label}: ${elapsedMs.toFixed(1)} ms`);
    return { result, elapsedMs };
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

  it("load test: prefilled stored table with hundreds of thousands of rows stays functional and fast", async () => {
    const loadRowCount = DEFAULT_LOAD_ROW_COUNT;
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
    const concatenatedDeltaRows = await readRows(concatenatedByTeam.listRowsInGroup({
      groupKey: expr(`to_jsonb('delta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(concatenatedDeltaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
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

    logLine(`[bulldozer-perf] load thresholds(ms): prefill<=${LOAD_PREFILL_MAX_MS}, baseCount<=${LOAD_COUNT_QUERY_MAX_MS}, setRowAvg<=${LOAD_SET_ROW_AVG_MAX_MS} over ${LOAD_SET_ROW_AVG_ITERATIONS}, pointDelete<=${LOAD_POINT_MUTATION_MAX_MS}, derivedInit<=${LOAD_DERIVED_INIT_MAX_MS}, filterInit<=${LOAD_FILTER_TABLE_INIT_MAX_MS}, concatInit<=${LOAD_CONCAT_TABLE_INIT_MAX_MS}, limitInit<=${LOAD_LIMIT_TABLE_INIT_MAX_MS}, expandingInit<=${LOAD_EXPANDING_INIT_MAX_MS}, derivedCount<=${LOAD_DERIVED_COUNT_QUERY_MAX_MS}, filterCount<=${LOAD_FILTER_TABLE_COUNT_QUERY_MAX_MS}, concatCount<=${LOAD_CONCAT_TABLE_COUNT_QUERY_MAX_MS}, limitCount<=${LOAD_LIMIT_TABLE_COUNT_QUERY_MAX_MS}, expandingCount<=${LOAD_EXPANDING_COUNT_QUERY_MAX_MS}, filteredQuery<=${LOAD_FILTERED_QUERY_MAX_MS}, tableDelete<=${LOAD_TABLE_DELETE_MAX_MS}`);
  }, 180_000);
});

