import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declareGroupByTable, declareMapTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

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

function operationCountFromEnv(varName: string, fallback: number): number {
  const env = Reflect.get(import.meta, "env");
  const raw = Reflect.get(env, varName);
  if (typeof raw !== "string") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
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
    const warmupCount = operationCountFromEnv("STACK_BULLDOZER_PERF_WARMUP_OPS", DEFAULT_WARMUP_OPS);
    const measuredCount = operationCountFromEnv("STACK_BULLDOZER_PERF_MEASURED_OPS", DEFAULT_MEASURED_OPS);
    const warmupOperations = createWorkload(111, warmupCount);
    const measuredOperations = createWorkload(222, measuredCount);

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
    logLine(`[bulldozer-perf] config: warmup=${warmupCount}, measured=${measuredCount}`);

    expect(baseline.operationsPerSecond).toBeGreaterThan(0);
    expect(composed.operationsPerSecond).toBeGreaterThan(0);
  });
});

