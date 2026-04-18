import { stringCompare, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Table } from "./index";
import {
  createBulldozerExecutionContext,
  declareCompactTable,
  declareConcatTable,
  declareFilterTable,
  declareFlatMapTable,
  declareGroupByTable,
  declareLeftJoinTable,
  declareLFoldTable,
  declareLimitTable,
  declareMapTable,
  declareReduceTable,
  declareSortTable,
  declareStoredTable,
  declareTimeFoldTable,
  toExecutableSqlTransaction,
  toQueryableSqlQuery,
} from "./index";

type TestDb = { full: string, base: string };

const TEST_DB_PREFIX = "stack_bulldozer_db_test";

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

const sqlStringLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlStatement = (strings: TemplateStringsArray, ...values: { sql: string }[]): SqlStatement => ({
  type: "statement",
  sql: templateIdentity(strings, ...values.map((value) => value.sql)),
});

describe.sequential("declareStoredTable (real postgres)", () => {
  let executionContext = createBulldozerExecutionContext();

  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });

  async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(executionContext, statements));
  }

  async function readBoolean(expression: SqlExpression<boolean>) {
    const rows = await sql.unsafe(`SELECT (${expression.sql}) AS "value"`);
    return rows[0].value === true;
  }

  async function readRows(query: SqlQuery) {
    return await sql.unsafe(toQueryableSqlQuery(query));
  }

  async function readTriggerAuditRows() {
    return await sql.unsafe(`
      SELECT
        "event",
        "rowIdentifier",
        "oldRowData",
        "newRowData"
      FROM "BulldozerTriggerAudit"
      ORDER BY "id"
    `);
  }
  async function readGroupTriggerAuditRows() {
    return await sql.unsafe(`
      SELECT
        "event",
        "groupKey"#>>'{}' AS "groupKey",
        "rowIdentifier",
        "oldRowData",
        "newRowData"
      FROM "BulldozerGroupTriggerAudit"
      ORDER BY "id"
    `);
  }
  async function readMapTriggerAuditRows() {
    return await sql.unsafe(`
      SELECT
        "event",
        "groupKey"#>>'{}' AS "groupKey",
        "rowIdentifier",
        "oldRowData",
        "newRowData"
      FROM "BulldozerMapTriggerAudit"
      ORDER BY "id"
    `);
  }
  async function readTimeFoldQueueRows() {
    const queueRowsRaw = await sql<Array<Record<string, unknown>>>`
      SELECT
        "rowIdentifier",
        "groupKey"#>>'{}' AS "groupKey",
        ("stateAfter"#>>'{}')::int AS "stateAfter",
        "rowData"
      FROM "BulldozerTimeFoldQueue"
      ORDER BY "rowIdentifier" ASC, "groupKey"#>>'{}' ASC NULLS FIRST
    `;
    return queueRowsRaw.map((row) => ({
      rowIdentifier: (() => {
        const raw = Reflect.get(row, "rowIdentifier") ?? Reflect.get(row, "rowidentifier");
        if (typeof raw !== "string") throw new Error("expected string rowIdentifier");
        return raw;
      })(),
      groupKey: (() => {
        const raw = Reflect.get(row, "groupKey") ?? Reflect.get(row, "groupkey");
        if (raw === undefined) return null;
        if (raw === null || typeof raw === "string") return raw;
        throw new Error("expected nullable string groupKey");
      })(),
      stateAfter: (() => {
        const raw = Reflect.get(row, "stateAfter") ?? Reflect.get(row, "stateafter");
        if (typeof raw !== "number") throw new Error("expected numeric stateAfter");
        return raw;
      })(),
      rowData: (() => {
        const raw = Reflect.get(row, "rowData") ?? Reflect.get(row, "rowdata");
        if (raw == null || typeof raw !== "object") throw new Error("expected object rowData");
        return raw;
      })(),
    }));
  }

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    executionContext = createBulldozerExecutionContext();
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldDownstreamCascade"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldQueue"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldMetadata"`;
    await sql`DROP TABLE IF EXISTS "BulldozerMapTriggerAudit"`;
    await sql`DROP TABLE IF EXISTS "BulldozerGroupTriggerAudit"`;
    await sql`DROP TABLE IF EXISTS "BulldozerTriggerAudit"`;
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
      CREATE TABLE "BulldozerTriggerAudit" (
        "id" SERIAL PRIMARY KEY,
        "event" TEXT NOT NULL,
        "rowIdentifier" TEXT,
        "oldRowData" JSONB,
        "newRowData" JSONB
      )
    `;
    await sql`
      CREATE TABLE "BulldozerGroupTriggerAudit" (
        "id" SERIAL PRIMARY KEY,
        "event" TEXT NOT NULL,
        "groupKey" JSONB,
        "rowIdentifier" TEXT,
        "oldRowData" JSONB,
        "newRowData" JSONB
      )
    `;
    await sql`
      CREATE TABLE "BulldozerMapTriggerAudit" (
        "id" SERIAL PRIMARY KEY,
        "event" TEXT NOT NULL,
        "groupKey" JSONB,
        "rowIdentifier" TEXT,
        "oldRowData" JSONB,
        "newRowData" JSONB
      )
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
  });

  type TableExecutionContext = Parameters<Table<any, any, any>["verifyDataIntegrity"]>[0];
  const allInitializedTables: Array<{ verifyDataIntegrity: (executionContext: TableExecutionContext) => SqlQuery }> = [];
  function trackTable<T extends Table<any, any, any>>(table: T): T {
    allInitializedTables.push(table);
    return table;
  }

  afterEach(async () => {
    for (const table of allInitializedTables) {
      const errors = await readRows(table.verifyDataIntegrity(executionContext));
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

  function registerAuditTrigger(
    table: ReturnType<typeof declareStoredTable<{ value: number }>>,
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerTriggerAudit" (
          "event",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function createGroupedTable() {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    return { fromTable, groupedTable };
  }
  function createMappedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const mappedTable = trackTable(declareMapTable({
      tableId: "users-by-team-mapped",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 100) AS "mappedValue"
      `),
    }));
    return { fromTable, groupedTable, mappedTable };
  }
  function createFlatMappedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const flatMappedTable = trackTable(declareFlatMapTable({
      tableId: "users-by-team-flat-mapped",
      fromTable: groupedTable,
      mapper: mapper(`
        CASE
          WHEN (("rowData"->>'value')::int) < 0 THEN '[]'::jsonb
          ELSE jsonb_build_array(
            jsonb_build_object(
              'team', "rowData"->'team',
              'kind', 'base',
              'mappedValue', (("rowData"->>'value')::int + 100)
            ),
            jsonb_build_object(
              'team', "rowData"->'team',
              'kind', 'double',
              'mappedValue', (("rowData"->>'value')::int * 2)
            )
          )
        END AS "rows"
      `),
    }));
    return { fromTable, groupedTable, flatMappedTable };
  }
  function createFilteredTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const filteredTable = trackTable(declareFilterTable({
      tableId: "users-by-team-filtered",
      fromTable: groupedTable,
      filter: predicate(`(("rowData"->>'value')::int) >= 2`),
    }));
    return { fromTable, groupedTable, filteredTable };
  }
  function createLimitedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const limitedTable = trackTable(declareLimitTable({
      tableId: "users-by-team-limited",
      fromTable: groupedTable,
      limit: expr(`2`),
    }));
    return { fromTable, groupedTable, limitedTable };
  }
  function createConcatenatedTable() {
    const fromTableA = declareStoredTable<{ value: number, team: string }>({ tableId: "users-a" });
    const fromTableB = declareStoredTable<{ value: number, team: string }>({ tableId: "users-b" });
    const groupedTableA = trackTable(declareGroupByTable({
      tableId: "users-a-by-team",
      fromTable: fromTableA,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableB = trackTable(declareGroupByTable({
      tableId: "users-b-by-team",
      fromTable: fromTableB,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const concatenatedTable = trackTable(declareConcatTable({
      tableId: "users-by-team-concat",
      tables: [groupedTableA, groupedTableB],
    }));
    return { fromTableA, fromTableB, groupedTableA, groupedTableB, concatenatedTable };
  }
  function createSortedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const sortedTable = trackTable(declareSortTable({
      tableId: "users-by-team-sorted",
      fromTable: groupedTable,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    }));
    return { fromTable, groupedTable, sortedTable };
  }
  function createDescendingSortedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const sortedTable = trackTable(declareSortTable({
      tableId: "users-by-team-sorted-desc",
      fromTable: groupedTable,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${b.sql}) #>> '{}')::int) - (((${a.sql}) #>> '{}')::int)`),
    }));
    return { fromTable, groupedTable, sortedTable };
  }
  function createDescendingLimitedTable() {
    const { fromTable, groupedTable, sortedTable } = createDescendingSortedTable();
    const limitedTable = trackTable(declareLimitTable({
      tableId: "users-by-team-limit-desc",
      fromTable: sortedTable,
      limit: expr(`2`),
    }));
    return { fromTable, groupedTable, sortedTable, limitedTable };
  }
  function createDescendingLFoldTable() {
    const { fromTable, groupedTable, sortedTable } = createDescendingSortedTable();
    const lFoldTable = trackTable(declareLFoldTable({
      tableId: "users-by-team-lfold-desc",
      fromTable: sortedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        "oldState" AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'value', (("oldRowData"->>'value')::int)
          )
        ) AS "newRowsData"
      `),
    }));
    return { fromTable, groupedTable, sortedTable, lFoldTable };
  }
  function createLFoldTable() {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    const lFoldTable = trackTable(declareLFoldTable({
      tableId: "users-by-team-lfold",
      fromTable: sortedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        (
          COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)
        ) AS "newState",
        (
          CASE
            WHEN ((("oldRowData"->>'value')::int) % 2) = 0 THEN jsonb_build_array(
              jsonb_build_object(
                'kind', 'running',
                'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                'value', (("oldRowData"->>'value')::int)
              ),
              jsonb_build_object(
                'kind', 'even-marker',
                'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                'value', (("oldRowData"->>'value')::int)
              )
            )
            ELSE jsonb_build_array(
              jsonb_build_object(
                'kind', 'running',
                'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                'value', (("oldRowData"->>'value')::int)
              )
            )
          END
        ) AS "newRowsData"
      `),
    }));
    return { fromTable, groupedTable, sortedTable, lFoldTable };
  }
  function createTimeFoldTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const timeFoldTable = trackTable(declareTimeFoldTable({
      tableId: "users-by-team-timefold",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        (
          COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)
        ) AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
            'value', (("oldRowData"->>'value')::int),
            'timestamp',
              CASE
                WHEN "timestamp" IS NULL THEN 'null'::jsonb
                ELSE to_jsonb("timestamp")
              END
          )
        ) AS "newRowsData",
        CASE
          WHEN "timestamp" IS NULL THEN (now() + interval '10 minutes')
          ELSE NULL::timestamptz
        END AS "nextTimestamp"
      `),
    }));
    return { fromTable, groupedTable, timeFoldTable };
  }
  function createLeftJoinedTable() {
    const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "left-join-users" });
    const joinTable = declareStoredTable<{ team: string | null, threshold: number, label: string }>({ tableId: "left-join-rules" });
    const groupedFromTable = trackTable(declareGroupByTable({
      tableId: "left-join-users-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedJoinTable = trackTable(declareGroupByTable({
      tableId: "left-join-rules-by-team",
      fromTable: joinTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const leftJoinedTable = trackTable(declareLeftJoinTable({
      tableId: "left-join-users-rules",
      leftTable: groupedFromTable,
      rightTable: groupedJoinTable,
      leftJoinKey: mapper(`(("rowData"->>'value')::int) AS "joinKey"`),
      rightJoinKey: mapper(`(("rowData"->>'threshold')::int) AS "joinKey"`),
    }));
    return { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable };
  }
  function createFlatMapMapGroupPipeline() {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    const mappedAfterFlatMap = trackTable(declareMapTable({
      tableId: "users-by-team-flat-map-then-map",
      fromTable: flatMappedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        ("rowData"->'kind') AS "kind",
        (("rowData"->>'mappedValue')::int + 1) AS "mappedValuePlusOne"
      `),
    }));
    const groupedByKind = trackTable(declareGroupByTable({
      tableId: "users-by-kind",
      fromTable: mappedAfterFlatMap,
      groupBy: mapper(`"rowData"->'kind' AS "groupKey"`),
    }));
    return { fromTable, groupedTable, flatMappedTable, mappedAfterFlatMap, groupedByKind };
  }
  function createStackedMappedTables() {
    const { fromTable, groupedTable } = createGroupedTable();
    const mappedTableLevel1 = trackTable(declareMapTable({
      tableId: "users-by-team-map-level-1",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 10) AS "valuePlusTen"
      `),
    }));
    const mappedTableLevel2 = trackTable(declareMapTable({
      tableId: "users-by-team-map-level-2",
      fromTable: mappedTableLevel1,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'valuePlusTen')::int * 2) AS "valueScaled",
        (
          CASE
            WHEN (("rowData"->>'valuePlusTen')::int * 2) >= 30 THEN 'high'
            ELSE 'low'
          END
        ) AS "bucket"
      `),
    }));
    return { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 };
  }
  function createGroupMapGroupPipeline() {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    const groupedByBucketTable = trackTable(declareGroupByTable({
      tableId: "users-by-bucket",
      fromTable: mappedTableLevel2,
      groupBy: mapper(`"rowData"->'bucket' AS "groupKey"`),
    }));
    return { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2, groupedByBucketTable };
  }
  function registerGroupAuditTrigger(
    table: ReturnType<typeof createGroupedTable>["groupedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerGroupTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerMapAuditTrigger(
    table: ReturnType<typeof createMappedTable>["mappedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerFlatMapAuditTrigger(
    table: ReturnType<typeof createFlatMappedTable>["flatMappedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerFilterAuditTrigger(
    table: ReturnType<typeof createFilteredTable>["filteredTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerLimitAuditTrigger(
    table: ReturnType<typeof createLimitedTable>["limitedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerConcatAuditTrigger(
    table: ReturnType<typeof createConcatenatedTable>["concatenatedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerSortAuditTrigger(
    table: ReturnType<typeof createSortedTable>["sortedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          jsonb_build_object(
            'rowSortKey', "oldRowSortKey",
            'rowData', "oldRowData"
          ),
          jsonb_build_object(
            'rowSortKey', "newRowSortKey",
            'rowData', "newRowData"
          )
        FROM ${changesTable}
      `,
    ]);
  }
  function registerLFoldAuditTrigger(
    table: ReturnType<typeof createLFoldTable>["lFoldTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          jsonb_build_object(
            'rowSortKey', "oldRowSortKey",
            'rowData', "oldRowData"
          ),
          jsonb_build_object(
            'rowSortKey', "newRowSortKey",
            'rowData', "newRowData"
          )
        FROM ${changesTable}
      `,
    ]);
  }
  function registerTimeFoldAuditTrigger(
    table: ReturnType<typeof createTimeFoldTable>["timeFoldTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  function registerLeftJoinAuditTrigger(
    table: ReturnType<typeof createLeftJoinedTable>["leftJoinedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral(event))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
  }
  type TriggerLifecycleStats = {
    registerCalls: number,
    deregisterCalls: number,
    activeRegistrations: number,
  };
  function instrumentTriggerLifecycle<
    T extends {
      registerRowChangeTrigger(
        trigger: Parameters<Table<any, any, any>["registerRowChangeTrigger"]>[0]
      ): { deregister: () => void },
    },
  >(table: T): { table: T, getStats: () => TriggerLifecycleStats } {
    const stats: TriggerLifecycleStats = {
      registerCalls: 0,
      deregisterCalls: 0,
      activeRegistrations: 0,
    };
    const instrumentedTable: T = {
      ...table,
      registerRowChangeTrigger: (trigger) => {
        stats.registerCalls += 1;
        stats.activeRegistrations += 1;
        const registration = table.registerRowChangeTrigger(trigger);
        return {
          deregister: () => {
            stats.deregisterCalls += 1;
            stats.activeRegistrations -= 1;
            registration.deregister();
          },
        };
      },
    };
    return {
      table: instrumentedTable,
      getStats: () => ({ ...stats }),
    };
  }

  test("setRow/init/delete SQL generation is deterministic on a mixed schema", () => {
    const sourceA = declareStoredTable<{ value: number, team: string | null, t: number }>({ tableId: "det-source-a" });
    const sourceB = declareStoredTable<{ value: number, team: string | null, t: number }>({ tableId: "det-source-b" });
    const joinRules = declareStoredTable<{ team: string | null, threshold: number, label: string }>({ tableId: "det-join-rules" });
    const compactEntries = declareStoredTable<{ itemId: string, quantity: number, t: number }>({ tableId: "det-compact-entries" });
    const compactBoundaries = declareStoredTable<{ t: number }>({ tableId: "det-compact-boundaries" });

    const groupedA = declareGroupByTable({
      tableId: "det-grouped-a",
      fromTable: sourceA,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const groupedB = declareGroupByTable({
      tableId: "det-grouped-b",
      fromTable: sourceB,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const groupedRules = declareGroupByTable({
      tableId: "det-grouped-rules",
      fromTable: joinRules,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const mappedA = declareMapTable({
      tableId: "det-mapped-a",
      fromTable: groupedA,
      mapper: mapper(`"rowData"->'team' AS "team", (("rowData"->>'value')::int + 1) AS "valuePlusOne"`),
    });
    const flatMappedA = declareFlatMapTable({
      tableId: "det-flat-mapped-a",
      fromTable: groupedA,
      mapper: mapper(`
        jsonb_build_array(
          jsonb_build_object('team', "rowData"->'team', 'kind', 'base', 'mappedValue', ("rowData"->>'value')::int),
          jsonb_build_object('team', "rowData"->'team', 'kind', 'double', 'mappedValue', (("rowData"->>'value')::int) * 2)
        ) AS "rows"
      `),
    });
    const filteredA = declareFilterTable({
      tableId: "det-filtered-a",
      fromTable: groupedA,
      filter: predicate(`(("rowData"->>'value')::int) > 0`),
    });
    const sortedA = declareSortTable({
      tableId: "det-sorted-a",
      fromTable: groupedA,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    const limitedA = declareLimitTable({
      tableId: "det-limited-a",
      fromTable: sortedA,
      limit: expr(`2`),
    });
    const lFoldA = declareLFoldTable({
      tableId: "det-lfold-a",
      fromTable: sortedA,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        (COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)) AS "newState",
        jsonb_build_array(jsonb_build_object('runningTotal', (COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)))) AS "newRowsData"
      `),
    });
    const timeFoldA = declareTimeFoldTable({
      tableId: "det-timefold-a",
      fromTable: groupedA,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        "oldState" AS "newState",
        jsonb_build_array(jsonb_build_object('team', "oldRowData"->'team', 'value', (("oldRowData"->>'value')::int))) AS "newRowsData",
        NULL::timestamptz AS "nextTimestamp"
      `),
    });
    const reducedA = declareReduceTable({
      tableId: "det-reduced-a",
      fromTable: groupedA,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`(COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)) AS "newState"`),
      finalize: mapper(`jsonb_build_object('sum', ("state"#>>'{}')::int) AS "rowData"`),
    });
    const concatenated = declareConcatTable({
      tableId: "det-concat",
      tables: [groupedA, groupedB],
    });
    const leftJoined = declareLeftJoinTable({
      tableId: "det-left-join",
      leftTable: groupedA,
      rightTable: groupedRules,
      leftJoinKey: mapper(`"rowData"->'team' AS "joinKey"`),
      rightJoinKey: mapper(`"rowData"->'team' AS "joinKey"`),
    });
    const compactEntriesSorted = declareSortTable({
      tableId: "det-compact-entries-sorted",
      fromTable: compactEntries,
      getSortKey: mapper(`("rowData"->>'t')::int AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    const compactBoundariesSorted = declareSortTable({
      tableId: "det-compact-boundaries-sorted",
      fromTable: compactBoundaries,
      getSortKey: mapper(`("rowData"->>'t')::int AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    const compacted = declareCompactTable({
      tableId: "det-compacted",
      toBeCompactedTable: compactEntriesSorted,
      boundaryTable: compactBoundariesSorted,
      orderingKey: "t",
      compactKey: "quantity",
      partitionKey: "itemId",
    });

    const allTables: Table<any, any, any>[] = [
      sourceA,
      sourceB,
      joinRules,
      compactEntries,
      compactBoundaries,
      groupedA,
      groupedB,
      groupedRules,
      mappedA,
      flatMappedA,
      filteredA,
      sortedA,
      limitedA,
      lFoldA,
      timeFoldA,
      reducedA,
      concatenated,
      leftJoined,
      compactEntriesSorted,
      compactBoundariesSorted,
      compacted,
    ];

    const setRowCases: Array<{
      label: string,
      buildStatements: (executionContext: ReturnType<typeof createBulldozerExecutionContext>) => SqlStatement[],
    }> = [
      {
        label: "sourceA.setRow",
        buildStatements: (executionContext) => sourceA.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":3,"t":11}'::jsonb`)),
      },
      {
        label: "sourceB.setRow",
        buildStatements: (executionContext) => sourceB.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7,"t":12}'::jsonb`)),
      },
      {
        label: "joinRules.setRow",
        buildStatements: (executionContext) => joinRules.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":1,"label":"rule-a"}'::jsonb`)),
      },
      {
        label: "compactEntries.setRow",
        buildStatements: (executionContext) => compactEntries.setRow(executionContext, "e1", expr(`'{"itemId":"credits","quantity":5,"t":10}'::jsonb`)),
      },
      {
        label: "compactBoundaries.setRow",
        buildStatements: (executionContext) => compactBoundaries.setRow(executionContext, "b1", expr(`'{"t":20}'::jsonb`)),
      },
    ];

    for (const setRowCase of setRowCases) {
      const firstCtx = createBulldozerExecutionContext();
      const secondCtx = createBulldozerExecutionContext();
      const firstSql = toExecutableSqlTransaction(firstCtx, setRowCase.buildStatements(firstCtx));
      const secondSql = toExecutableSqlTransaction(secondCtx, setRowCase.buildStatements(secondCtx));
      expect(firstSql, setRowCase.label).toEqual(secondSql);
    }

    const buildInitSql = () => {
      const executionContext = createBulldozerExecutionContext();
      const statements = allTables.flatMap((table) => table.init(executionContext));
      return toExecutableSqlTransaction(executionContext, statements);
    };
    expect(buildInitSql()).toEqual(buildInitSql());

    const buildDeleteSql = () => {
      const executionContext = createBulldozerExecutionContext();
      const statements = [...allTables].reverse().flatMap((table) => table.delete(executionContext));
      return toExecutableSqlTransaction(executionContext, statements);
    };
    expect(buildDeleteSql()).toEqual(buildDeleteSql());
  });

  test("init/isInitialized/delete lifecycle", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    expect(await readBoolean(table.isInitialized(executionContext))).toBe(false);
    await runStatements(table.init(executionContext));
    expect(await readBoolean(table.isInitialized(executionContext))).toBe(true);
    await runStatements(table.delete(executionContext));
    expect(await readBoolean(table.isInitialized(executionContext))).toBe(false);
  });

  test("groupBy registers upstream trigger in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-groupby-lifecycle" });
    const fromTableInstrumentation = instrumentTriggerLifecycle(fromTable);
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-groupby-lifecycle-by-team",
      fromTable: fromTableInstrumentation.table,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));

    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.init(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.init(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.delete(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.delete(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.init(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    groupedTable.delete(executionContext);
    expect(fromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("flatMap registers upstream trigger in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-flatmap-lifecycle" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-flatmap-lifecycle-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableInstrumentation = instrumentTriggerLifecycle(groupedTable);
    const flatMappedTable = trackTable(declareFlatMapTable({
      tableId: "users-flatmap-lifecycle-expanded",
      fromTable: groupedTableInstrumentation.table,
      mapper: mapper(`jsonb_build_array("rowData") AS "rows"`),
    }));

    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    flatMappedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    flatMappedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    flatMappedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    flatMappedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("sort registers upstream trigger in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-sort-lifecycle" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-sort-lifecycle-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableInstrumentation = instrumentTriggerLifecycle(groupedTable);
    const sortedTable = trackTable(declareSortTable({
      tableId: "users-sort-lifecycle-sorted",
      fromTable: groupedTableInstrumentation.table,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    }));

    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    sortedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    sortedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    sortedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    sortedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("limit registers upstream trigger in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-limit-lifecycle" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-limit-lifecycle-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableInstrumentation = instrumentTriggerLifecycle(groupedTable);
    const limitedTable = trackTable(declareLimitTable({
      tableId: "users-limit-lifecycle-limited",
      fromTable: groupedTableInstrumentation.table,
      limit: expr(`2`),
    }));

    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    limitedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    limitedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    limitedTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    limitedTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("concat registers all upstream triggers in init and deregisters in delete", () => {
    const fromTableA = declareStoredTable<{ value: number, team: string }>({ tableId: "users-concat-lifecycle-a" });
    const fromTableB = declareStoredTable<{ value: number, team: string }>({ tableId: "users-concat-lifecycle-b" });
    const groupedTableA = trackTable(declareGroupByTable({
      tableId: "users-concat-lifecycle-a-by-team",
      fromTable: fromTableA,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableB = trackTable(declareGroupByTable({
      tableId: "users-concat-lifecycle-b-by-team",
      fromTable: fromTableB,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableAInstrumentation = instrumentTriggerLifecycle(groupedTableA);
    const groupedTableBInstrumentation = instrumentTriggerLifecycle(groupedTableB);
    const concatenatedTable = trackTable(declareConcatTable({
      tableId: "users-concat-lifecycle",
      tables: [groupedTableAInstrumentation.table, groupedTableBInstrumentation.table],
    }));

    expect(groupedTableAInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedTableBInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    concatenatedTable.init(executionContext);
    expect(groupedTableAInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedTableBInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    concatenatedTable.delete(executionContext);
    expect(groupedTableAInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedTableBInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    concatenatedTable.init(executionContext);
    expect(groupedTableAInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedTableBInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    concatenatedTable.delete(executionContext);
    expect(groupedTableAInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedTableBInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  // "lfold registers upstream trigger in init and deregisters in delete" was
  // removed: with topological trigger dispatch, triggers register eagerly in the
  // constructor rather than lazily in init()/delete().

  test("timefold registers upstream trigger in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-timefold-lifecycle" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-timefold-lifecycle-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedTableInstrumentation = instrumentTriggerLifecycle(groupedTable);
    const timeFoldTable = trackTable(declareTimeFoldTable({
      tableId: "users-timefold-lifecycle-folded",
      fromTable: groupedTableInstrumentation.table,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        "oldState" AS "newState",
        jsonb_build_array("oldRowData") AS "newRowsData",
        NULL::timestamptz AS "nextTimestamp"
      `),
    }));

    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    timeFoldTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    timeFoldTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    timeFoldTable.init(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    timeFoldTable.delete(executionContext);
    expect(groupedTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("leftJoin registers all upstream triggers in init and deregisters in delete", () => {
    const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "users-left-join-lifecycle" });
    const joinTable = declareStoredTable<{ team: string | null, threshold: number, label: string }>({ tableId: "rules-left-join-lifecycle" });
    const groupedFromTable = trackTable(declareGroupByTable({
      tableId: "users-left-join-lifecycle-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedJoinTable = trackTable(declareGroupByTable({
      tableId: "rules-left-join-lifecycle-by-team",
      fromTable: joinTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedFromTableInstrumentation = instrumentTriggerLifecycle(groupedFromTable);
    const groupedJoinTableInstrumentation = instrumentTriggerLifecycle(groupedJoinTable);
    const leftJoinedTable = trackTable(declareLeftJoinTable({
      tableId: "users-rules-left-join-lifecycle",
      leftTable: groupedFromTableInstrumentation.table,
      rightTable: groupedJoinTableInstrumentation.table,
      leftJoinKey: mapper(`(("rowData"->>'value')::int) AS "joinKey"`),
      rightJoinKey: mapper(`(("rowData"->>'threshold')::int) AS "joinKey"`),
    }));

    expect(groupedFromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedJoinTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    leftJoinedTable.init(executionContext);
    expect(groupedFromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedJoinTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    leftJoinedTable.delete(executionContext);
    expect(groupedFromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedJoinTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    leftJoinedTable.init(executionContext);
    expect(groupedFromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedJoinTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    leftJoinedTable.delete(executionContext);
    expect(groupedFromTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
    expect(groupedJoinTableInstrumentation.getStats()).toEqual({ registerCalls: 1, deregisterCalls: 0, activeRegistrations: 1 });
  });

  test("trigger emits insert change row", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    registerAuditTrigger(table, "insert");

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));

    expect(await readTriggerAuditRows()).toEqual([
      {
        event: "insert",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
    ]);
  });

  test("trigger emits update change row with old and new values", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    registerAuditTrigger(table, "update");

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":2}'::jsonb`)));

    expect(await readTriggerAuditRows()).toEqual([
      {
        event: "update",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
      {
        event: "update",
        rowIdentifier: "alpha",
        oldRowData: { value: 1 },
        newRowData: { value: 2 },
      },
    ]);
  });

  test("trigger emits delete change row only when row existed", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    registerAuditTrigger(table, "delete");

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.deleteRow(executionContext, "missing"));
    await runStatements(table.deleteRow(executionContext, "alpha"));

    expect(await readTriggerAuditRows()).toEqual([
      {
        event: "delete",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
      {
        event: "delete",
        rowIdentifier: "alpha",
        oldRowData: { value: 1 },
        newRowData: null,
      },
    ]);
  });

  test("deregistered trigger no longer runs", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    const handle = registerAuditTrigger(table, "deregister");

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(table.setRow(executionContext, "beta", expr(`'{"value":2}'::jsonb`)));

    expect(await readTriggerAuditRows()).toEqual([
      {
        event: "deregister",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
    ]);
  });

  test("multiple triggers run in one transaction", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    registerAuditTrigger(table, "trigger_a");
    registerAuditTrigger(table, "trigger_b");

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));

    expect((await readTriggerAuditRows()).sort((a, b) => stringCompare(a.event, b.event))).toEqual([
      {
        event: "trigger_a",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
      {
        event: "trigger_b",
        rowIdentifier: "alpha",
        oldRowData: null,
        newRowData: { value: 1 },
      },
    ]);
  });

  test("setRow upserts and listRowsInGroup returns raw identifiers", async () => {
    const table = declareStoredTable<{ value: number, label: string }>({ tableId: "users" });
    const weirdIdentifier = "row.with/slash and spaces";

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, weirdIdentifier, expr(`'{"value":1,"label":"first"}'::jsonb`)));
    await runStatements(table.setRow(executionContext, weirdIdentifier, expr(`'{"value":2,"label":"second"}'::jsonb`)));
    await runStatements(table.setRow(executionContext, "plain-row", expr(`'{"value":3,"label":"third"}'::jsonb`)));

    const rows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));

    const mapped = rows
      .map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier));

    expect(mapped).toEqual([
      {
        rowIdentifier: "plain-row",
        rowData: { label: "third", value: 3 },
      },
      {
        rowIdentifier: weirdIdentifier,
        rowData: { label: "second", value: 2 },
      },
    ]);
  });

  test("storedTable all-groups rows include groupKey and respect non-null group filters", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "a", expr(`'{"value":1}'::jsonb`)));

    const allGroupsRows = await readRows(table.listRowsInGroup(executionContext, {
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allGroupsRows).toHaveLength(1);
    expect(allGroupsRows[0].groupkey).toBe(null);
    expect(allGroupsRows[0].rowidentifier).toBe("a");

    const nonNullGroupRows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nonNullGroupRows).toEqual([]);
  });

  test("table contents snapshot after init + upserts", async () => {
    const table = declareStoredTable<{ value: number, label: string }>({ tableId: "users" });
    const weirdIdentifier = "row.with/slash and spaces";

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, weirdIdentifier, expr(`'{"value":1,"label":"first"}'::jsonb`)));
    await runStatements(table.setRow(executionContext, weirdIdentifier, expr(`'{"value":2,"label":"second"}'::jsonb`)));
    await runStatements(table.setRow(executionContext, "plain-row", expr(`'{"value":3,"label":"third"}'::jsonb`)));

    const rows = await sql.unsafe(`
      SELECT array_to_string(ARRAY(SELECT x #>> '{}' FROM unnest("keyPath") AS x), ' -> ') AS "keyPath", "value"
      FROM "BulldozerStorageEngine"
      ORDER BY "keyPath"
    `);
    const snapshotRows = [...rows].map((row) => ({ keyPath: row.keyPath, value: row.value }));

    expect(snapshotRows).toMatchInlineSnapshot(`
      [
        {
          "keyPath": "",
          "value": null,
        },
        {
          "keyPath": "table",
          "value": null,
        },
        {
          "keyPath": "table -> external:users",
          "value": null,
        },
        {
          "keyPath": "table -> external:users -> storage",
          "value": null,
        },
        {
          "keyPath": "table -> external:users -> storage -> metadata",
          "value": {
            "version": 1,
          },
        },
        {
          "keyPath": "table -> external:users -> storage -> rows",
          "value": null,
        },
        {
          "keyPath": "table -> external:users -> storage -> rows -> plain-row",
          "value": {
            "rowData": {
              "label": "third",
              "value": 3,
            },
          },
        },
        {
          "keyPath": "table -> external:users -> storage -> rows -> row.with/slash and spaces",
          "value": {
            "rowData": {
              "label": "second",
              "value": 2,
            },
          },
        },
      ]
    `);
  });

  test("generated keyPathParent rejects explicit writes", async () => {
    await expect(sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "keyPathParent", "value")
      VALUES (
        ARRAY[to_jsonb('table'::text), to_jsonb('external:users'::text), to_jsonb('storage'::text), to_jsonb('rows'::text), to_jsonb('x'::text)]::jsonb[],
        ARRAY[to_jsonb('table'::text), to_jsonb('external:users'::text), to_jsonb('storage'::text)]::jsonb[],
        '{"rowData":{"value":1}}'::jsonb
      )
    `).rejects.toThrow('cannot insert a non-DEFAULT value into column "keyPathParent"');
  });

  test("keyPathParent foreign key rejects missing parent rows", async () => {
    await expect(sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES (
        ARRAY[to_jsonb('missing-parent'::text), to_jsonb('child'::text)]::jsonb[],
        '{"rowData":{"value":1}}'::jsonb
      )
    `).rejects.toThrow('BulldozerStorageEngine_keyPathParent_fkey');
  });

  test("deleteRow removes only the target row and missing rows are no-op", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });

    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "a", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.setRow(executionContext, "b", expr(`'{"value":2}'::jsonb`)));
    await runStatements(table.deleteRow(executionContext, "missing"));
    await runStatements(table.deleteRow(executionContext, "a"));

    const rows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata).toEqual({ value: 2 });
    expect(await readBoolean(table.isInitialized(executionContext))).toBe(true);
  });

  test("exclusive start/end excludes the single null group and rowSortKey", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "row", expr(`'{"value":1}'::jsonb`)));

    const groups = await readRows(table.listGroups(executionContext, {
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(groups).toHaveLength(0);

    const rows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(rows).toHaveLength(0);
  });

  test("table paths are isolated by tableId", async () => {
    const left = declareStoredTable<{ value: number }>({ tableId: "left" });
    const right = declareStoredTable<{ value: number }>({ tableId: "right" });

    await runStatements(left.init(executionContext));
    await runStatements(right.init(executionContext));
    await runStatements(left.setRow(executionContext, "shared", expr(`'{"value":1}'::jsonb`)));
    await runStatements(right.setRow(executionContext, "shared", expr(`'{"value":2}'::jsonb`)));
    await runStatements(left.delete(executionContext));

    const rightRows = await readRows(right.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));

    expect(await readBoolean(left.isInitialized(executionContext))).toBe(false);
    expect(await readBoolean(right.isInitialized(executionContext))).toBe(true);
    expect(rightRows).toHaveLength(1);
    expect(rightRows[0].rowdata).toEqual({ value: 2 });
  });

  test("rowIdentifier from listRowsInGroup can be passed to deleteRow", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "plain-row", expr(`'{"value":1}'::jsonb`)));

    const listedRows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(listedRows).toHaveLength(1);

    await runStatements(table.deleteRow(executionContext, listedRows[0].rowidentifier));

    const remainingRows = await readRows(table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(remainingRows).toHaveLength(0);
  });

  test("groupBy init backfills groups and rows from source table", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));

    await runStatements(groupedTable.init(executionContext));

    const groups = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      { rowIdentifier: "u1", rowData: { team: "alpha", value: 1 } },
      { rowIdentifier: "u3", rowData: { team: "alpha", value: 3 } },
    ]);

    const allRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "u1" },
      { groupKey: "alpha", rowIdentifier: "u3" },
      { groupKey: "beta", rowIdentifier: "u2" },
    ]);
  });

  test("groupBy registerRowChangeTrigger emits insert/update/move/delete changes", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerGroupAuditTrigger(groupedTable, "group_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    expect(await readGroupTriggerAuditRows()).toEqual([
      {
        event: "group_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", value: 1 },
      },
      {
        event: "group_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", value: 1 },
        newRowData: { team: "alpha", value: 2 },
      },
      {
        event: "group_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", value: 2 },
        newRowData: null,
      },
      {
        event: "group_change",
        groupKey: "beta",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "beta", value: 3 },
      },
      {
        event: "group_change",
        groupKey: "beta",
        rowIdentifier: "u1",
        oldRowData: { team: "beta", value: 3 },
        newRowData: null,
      },
    ]);
  });

  test("groupBy deregistered trigger no longer runs", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    const handle = registerGroupAuditTrigger(groupedTable, "group_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readGroupTriggerAuditRows()).toEqual([
      {
        event: "group_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", value: 1 },
      },
    ]);
  });

  test("groupBy stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    registerGroupAuditTrigger(groupedTable, "group_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(groupedTable.isInitialized(executionContext))).toBe(false);
    expect(await readGroupTriggerAuditRows()).toEqual([]);
    const groups = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("groupBy delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(groupedTable.delete(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(groupedTable.isInitialized(executionContext))).toBe(false);
    const groupsBeforeReinit = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(groupedTable.init(executionContext));
    const groupsAfterReinit = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("groupBy listGroups applies group-key ranges", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"gamma","value":3}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));

    const inclusive = await readRows(groupedTable.listGroups(executionContext, {
      start: expr(`to_jsonb('beta'::text)`),
      end: expr(`to_jsonb('gamma'::text)`),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(inclusive.map((row) => row.groupkey).sort(stringCompare)).toEqual(["beta", "gamma"]);

    const exclusive = await readRows(groupedTable.listGroups(executionContext, {
      start: expr(`to_jsonb('beta'::text)`),
      end: expr(`to_jsonb('gamma'::text)`),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(exclusive).toEqual([]);
  });

  test("groupBy removes empty groups after moves and deletes", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    const groupsAfterInsert = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterInsert.map((row) => row.groupkey)).toEqual(["alpha"]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    const groupsAfterMove = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["beta"]);

    await runStatements(fromTable.deleteRow(executionContext, "u1"));
    const groupsAfterDelete = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterDelete).toEqual([]);
  });

  test("groupBy deletes stale group paths from storage", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    const staleGroupPaths = await sql`
      SELECT array_to_string(ARRAY(SELECT x #>> '{}' FROM unnest("keyPath") AS x), '.') AS "keyPath"
      FROM "BulldozerStorageEngine"
      WHERE "keyPath"[1:4] = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team'::text),
        to_jsonb('storage'::text),
        to_jsonb('groups'::text)
      ]::jsonb[]
      AND cardinality("keyPath") > 4
      ORDER BY "keyPath"
    `;
    expect(staleGroupPaths).toEqual([]);
  });

  test("groupBy listRowsInGroup handles missing groups and exclusive bounds", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const missingGroupRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('missing'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(missingGroupRows).toEqual([]);

    const exclusiveRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr(`'null'::jsonb`),
      end: expr(`'null'::jsonb`),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(exclusiveRows).toEqual([]);

    const inclusiveRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr(`'null'::jsonb`),
      end: expr(`'null'::jsonb`),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(inclusiveRows).toHaveLength(2);
  });

  test("groupBy listRowsInGroup (all groups) handles 'rows' collisions in group key and row identifier", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const normalizedRows = allRows
      .map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`));

    expect(normalizedRows).toEqual([
      { groupKey: "alpha", rowIdentifier: "rows", rowData: { team: "alpha", value: 2 } },
      { groupKey: "rows", rowIdentifier: "u1", rowData: { team: "rows", value: 1 } },
    ]);
  });

  test("groupBy multiple triggers run in one transaction", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerGroupAuditTrigger(groupedTable, "group_trigger_a");
    registerGroupAuditTrigger(groupedTable, "group_trigger_b");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    const rows = await readGroupTriggerAuditRows();
    expect(rows.map((row) => row.event).sort(stringCompare)).toEqual(["group_trigger_a", "group_trigger_b"]);
  });

  test("groupBy supports null group keys and transitions away cleanly", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":null,"value":1}'::jsonb`)));
    const nullGroupRows = await readRows(groupedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`'null'::jsonb`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nullGroupRows.map((row) => row.rowidentifier)).toEqual(["u1"]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    const groups = await readRows(groupedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  test("mapTable init backfills groups and mapped rows", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));

    const groups = await readRows(mappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      { rowIdentifier: "u1:1", rowData: { team: "alpha", mappedValue: 101 } },
      { rowIdentifier: "u3:1", rowData: { team: "alpha", mappedValue: 103 } },
    ]);

    const allRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "u1:1" },
      { groupKey: "alpha", rowIdentifier: "u3:1" },
      { groupKey: "beta", rowIdentifier: "u2:1" },
    ]);
  });

  test("mapTable registerRowChangeTrigger emits mapped insert/update/move/delete changes", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    expect(await readMapTriggerAuditRows()).toEqual([
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "alpha", mappedValue: 101 },
      },
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", mappedValue: 101 },
        newRowData: { team: "alpha", mappedValue: 102 },
      },
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", mappedValue: 102 },
        newRowData: null,
      },
      {
        event: "map_change",
        groupKey: "beta",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "beta", mappedValue: 103 },
      },
      {
        event: "map_change",
        groupKey: "beta",
        rowIdentifier: "u1:1",
        oldRowData: { team: "beta", mappedValue: 103 },
        newRowData: null,
      },
    ]);
  });

  test("mapTable uses flatMap-style rowIdentifier and skips unchanged updates", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow(executionContext, "user:1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "user:1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readMapTriggerAuditRows()).toEqual([
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "user:1:1",
        oldRowData: null,
        newRowData: { team: "alpha", mappedValue: 101 },
      },
    ]);

    const alphaRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["user:1:1"]);
  });

  test("mapTable deregistered trigger no longer runs", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    const handle = registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readMapTriggerAuditRows()).toEqual([
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "alpha", mappedValue: 101 },
      },
    ]);
  });

  test("mapTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerMapAuditTrigger(mappedTable, "map_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(mappedTable.isInitialized(executionContext))).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    const groups = await readRows(mappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("mapTable delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(mappedTable.delete(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(mappedTable.isInitialized(executionContext))).toBe(false);
    const groupsBeforeReinit = await readRows(mappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(mappedTable.init(executionContext));
    const groupsAfterReinit = await readRows(mappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("mapTable listRowsInGroup handles missing groups and exclusive bounds", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    const missingGroupRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('missing'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(missingGroupRows).toEqual([]);

    const exclusiveRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr(`'null'::jsonb`),
      end: expr(`'null'::jsonb`),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(exclusiveRows).toEqual([]);
  });

  test("mapTable listRowsInGroup (all groups) handles 'rows' collisions in group key and row identifier", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(mappedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const normalizedRows = allRows
      .map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`));

    expect(normalizedRows).toEqual([
      { groupKey: "alpha", rowIdentifier: "rows:1", rowData: { team: "alpha", mappedValue: 102 } },
      { groupKey: "rows", rowIdentifier: "u1:1", rowData: { team: "rows", mappedValue: 101 } },
    ]);
  });

  test("mapTable deletes stale group paths from storage", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    const staleGroupPaths = await sql`
      SELECT array_to_string(ARRAY(SELECT x #>> '{}' FROM unnest("keyPath") AS x), '.') AS "keyPath"
      FROM "BulldozerStorageEngine"
      WHERE "keyPath"[1:4] = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team-mapped'::text),
        to_jsonb('storage'::text),
        to_jsonb('groups'::text)
      ]::jsonb[]
      AND cardinality("keyPath") > 4
      ORDER BY "keyPath"
    `;
    expect(staleGroupPaths).toEqual([]);
  });

  test("mapTable matches equivalent single-row flatMap for rows, groups, and trigger payloads", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    const equivalentFlatMapTable = trackTable(declareFlatMapTable({
      tableId: "users-by-team-mapped-equivalent-flatmap",
      fromTable: groupedTable,
      mapper: mapper(`
        jsonb_build_array(
          COALESCE(
            (
              SELECT to_jsonb("mapped")
              FROM (
                SELECT
                  ("rowData"->'team') AS "team",
                  (("rowData"->>'value')::int + 100) AS "mappedValue"
              ) AS "mapped"
            ),
            'null'::jsonb
          )
        ) AS "rows"
      `),
    }));

    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTable.init(executionContext));
    await runStatements(equivalentFlatMapTable.init(executionContext));

    mappedTable.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral("map"))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
    equivalentFlatMapTable.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral("flat"))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    const mapGroups = await readRows(mappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const flatGroups = await readRows(equivalentFlatMapTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(mapGroups).toEqual(flatGroups);

    const normalizeRows = (rows: Iterable<Record<string, unknown>>) => [...rows]
      .map((row) => ({
        groupKey: (Reflect.get(row, "groupkey") as string | null),
        rowIdentifier: String(Reflect.get(row, "rowidentifier")),
        rowData: Reflect.get(row, "rowdata"),
      }))
      .sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`));
    const mapRows = normalizeRows(await readRows(mappedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })));
    const flatRows = normalizeRows(await readRows(equivalentFlatMapTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })));
    expect(mapRows).toEqual(flatRows);

    const normalizeAuditRows = (rows: Iterable<Record<string, unknown>>) => [...rows]
      .map((row) => ({
        groupKey: (Reflect.get(row, "groupKey") as string | null),
        rowIdentifier: String(Reflect.get(row, "rowIdentifier")),
        oldRowData: Reflect.get(row, "oldRowData"),
        newRowData: Reflect.get(row, "newRowData"),
      }))
      .sort((a, b) => stringCompare(
        `${a.groupKey}:${a.rowIdentifier}:${JSON.stringify(a.oldRowData)}:${JSON.stringify(a.newRowData)}`,
        `${b.groupKey}:${b.rowIdentifier}:${JSON.stringify(b.oldRowData)}:${JSON.stringify(b.newRowData)}`,
      ));
    const allAuditRows = await readMapTriggerAuditRows();
    const mapAudit = normalizeAuditRows(allAuditRows.filter((row) => row.event === "map"));
    const flatAudit = normalizeAuditRows(allAuditRows.filter((row) => row.event === "flat"));
    expect(mapAudit).toEqual(flatAudit);
  });

  test("flatMapTable init backfills fan-out rows and skips empty expansions", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":-1}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));

    const groups = await readRows(flatMappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(flatMappedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      { rowIdentifier: "u1:1", rowData: { team: "alpha", kind: "base", mappedValue: 101 } },
      { rowIdentifier: "u1:2", rowData: { team: "alpha", kind: "double", mappedValue: 2 } },
    ]);

    const allRows = await readRows(flatMappedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "u1:1" },
      { groupKey: "alpha", rowIdentifier: "u1:2" },
      { groupKey: "beta", rowIdentifier: "u2:1" },
      { groupKey: "beta", rowIdentifier: "u2:2" },
    ]);
  });

  test("flatMapTable registerRowChangeTrigger emits per-expanded-row inserts, updates, moves, and removals", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));
    registerFlatMapAuditTrigger(flatMappedTable, "flat_map_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":-1}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    const normalizedAuditRows = (await readMapTriggerAuditRows())
      .map((row) => ({
        groupKey: row.groupKey,
        rowIdentifier: row.rowIdentifier,
        oldRowData: row.oldRowData,
        newRowData: row.newRowData,
      }))
      .sort((a, b) => stringCompare(
        `${a.groupKey}:${a.rowIdentifier}:${JSON.stringify(a.oldRowData)}:${JSON.stringify(a.newRowData)}`,
        `${b.groupKey}:${b.rowIdentifier}:${JSON.stringify(b.oldRowData)}:${JSON.stringify(b.newRowData)}`,
      ));
    expect(normalizedAuditRows).toEqual([
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "alpha", kind: "base", mappedValue: 101 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", kind: "base", mappedValue: 101 },
        newRowData: { team: "alpha", kind: "base", mappedValue: 102 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", kind: "base", mappedValue: 102 },
        newRowData: null,
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:2",
        oldRowData: null,
        newRowData: { team: "alpha", kind: "double", mappedValue: 2 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:2",
        oldRowData: { team: "alpha", kind: "double", mappedValue: 2 },
        newRowData: { team: "alpha", kind: "double", mappedValue: 4 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:2",
        oldRowData: { team: "alpha", kind: "double", mappedValue: 4 },
        newRowData: null,
      },
      {
        groupKey: "beta",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "beta", kind: "base", mappedValue: 103 },
      },
      {
        groupKey: "beta",
        rowIdentifier: "u1:1",
        oldRowData: { team: "beta", kind: "base", mappedValue: 103 },
        newRowData: null,
      },
      {
        groupKey: "beta",
        rowIdentifier: "u1:2",
        oldRowData: null,
        newRowData: { team: "beta", kind: "double", mappedValue: 6 },
      },
      {
        groupKey: "beta",
        rowIdentifier: "u1:2",
        oldRowData: { team: "beta", kind: "double", mappedValue: 6 },
        newRowData: null,
      },
    ]);
  });

  test("flatMapTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerFlatMapAuditTrigger(flatMappedTable, "flat_map_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(flatMappedTable.isInitialized(executionContext))).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    const groups = await readRows(flatMappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("flatMapTable delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(flatMappedTable.delete(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(flatMappedTable.isInitialized(executionContext))).toBe(false);
    const groupsBeforeReinit = await readRows(flatMappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(flatMappedTable.init(executionContext));
    const groupsAfterReinit = await readRows(flatMappedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("flatMapTable listRowsInGroup (all groups) handles 'rows' collisions in group key and source row identifier", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(flatMappedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const normalizedRows = allRows
      .map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`));

    expect(normalizedRows).toEqual([
      { groupKey: "alpha", rowIdentifier: "rows:1", rowData: { team: "alpha", kind: "base", mappedValue: 102 } },
      { groupKey: "alpha", rowIdentifier: "rows:2", rowData: { team: "alpha", kind: "double", mappedValue: 4 } },
      { groupKey: "rows", rowIdentifier: "u1:1", rowData: { team: "rows", kind: "base", mappedValue: 101 } },
      { groupKey: "rows", rowIdentifier: "u1:2", rowData: { team: "rows", kind: "double", mappedValue: 2 } },
    ]);
  });

  test("flatMapTable deletes stale group paths from storage", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":-1}'::jsonb`)));

    const staleGroupPaths = await sql`
      SELECT array_to_string(ARRAY(SELECT x #>> '{}' FROM unnest("keyPath") AS x), '.') AS "keyPath"
      FROM "BulldozerStorageEngine"
      WHERE "keyPath"[1:4] = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team-flat-mapped'::text),
        to_jsonb('storage'::text),
        to_jsonb('groups'::text)
      ]::jsonb[]
      AND cardinality("keyPath") > 4
      ORDER BY "keyPath"
    `;
    expect(staleGroupPaths).toEqual([]);
  });

  test("filterTable init backfills matching rows, keeps own metadata, and deletes cleanly", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u4", expr(`'{"team":"beta","value":0}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(filteredTable.init(executionContext));

    expect(await readBoolean(filteredTable.isInitialized(executionContext))).toBe(true);

    const groups = await readRows(filteredTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const allRows = await readRows(filteredTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "u2:1", rowData: { team: "alpha", value: 2 } },
      { groupKey: "beta", rowIdentifier: "u3:1", rowData: { team: "beta", value: 3 } },
    ]);

    const metadataRows = await sql`
      SELECT 1
      FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team-filtered'::text),
        to_jsonb('storage'::text),
        to_jsonb('metadata'::text)
      ]::jsonb[]
    `;
    expect(metadataRows).toHaveLength(1);

    await runStatements(filteredTable.delete(executionContext));
    expect(await readBoolean(filteredTable.isInitialized(executionContext))).toBe(false);
    const groupsAfterDelete = await readRows(filteredTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterDelete).toEqual([]);
  });

  test("filterTable registerRowChangeTrigger emits inserts, updates, deletes, and moves", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(filteredTable.init(executionContext));
    registerFilterAuditTrigger(filteredTable, "filter_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":5}'::jsonb`)));

    const normalizedAuditRows = (await readMapTriggerAuditRows())
      .map((row) => ({
        groupKey: row.groupKey,
        rowIdentifier: row.rowIdentifier,
        oldRowData: row.oldRowData,
        newRowData: row.newRowData,
      }))
      .sort((a, b) => stringCompare(
        `${a.groupKey}:${a.rowIdentifier}:${JSON.stringify(a.oldRowData)}:${JSON.stringify(a.newRowData)}`,
        `${b.groupKey}:${b.rowIdentifier}:${JSON.stringify(b.oldRowData)}:${JSON.stringify(b.newRowData)}`,
      ));
    expect(normalizedAuditRows).toEqual([
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "alpha", value: 2 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", value: 2 },
        newRowData: { team: "alpha", value: 3 },
      },
      {
        groupKey: "alpha",
        rowIdentifier: "u1:1",
        oldRowData: { team: "alpha", value: 3 },
        newRowData: null,
      },
      {
        groupKey: "beta",
        rowIdentifier: "u1:1",
        oldRowData: null,
        newRowData: { team: "beta", value: 5 },
      },
    ]);
  });

  test("filterTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerFilterAuditTrigger(filteredTable, "filter_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    expect(await readBoolean(filteredTable.isInitialized(executionContext))).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    expect(await readRows(filteredTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("filterTable listRowsInGroup (all groups) handles 'rows' collisions in group key and source row identifier", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(filteredTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"rows","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "rows", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const allRows = await readRows(filteredTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "rows:1", rowData: { team: "alpha", value: 4 } },
      { groupKey: "rows", rowIdentifier: "u1:1", rowData: { team: "rows", value: 5 } },
    ]);
  });

  test("limitTable init keeps only first N rows per group and stores metadata", async () => {
    const { fromTable, groupedTable, limitedTable } = createLimitedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b1", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(limitedTable.init(executionContext));

    const groups = await readRows(limitedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const allRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "a1", rowData: { team: "alpha", value: 1 } },
      { groupKey: "alpha", rowIdentifier: "a2", rowData: { team: "alpha", value: 2 } },
      { groupKey: "beta", rowIdentifier: "b1", rowData: { team: "beta", value: 1 } },
      { groupKey: "beta", rowIdentifier: "b2", rowData: { team: "beta", value: 2 } },
    ]);

    const metadataRows = await sql`
      SELECT 1
      FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team-limited'::text),
        to_jsonb('storage'::text),
        to_jsonb('metadata'::text)
      ]::jsonb[]
    `;
    expect(metadataRows).toHaveLength(1);
  });

  test("limitTable membership shifts when boundary rows are inserted, updated, or deleted", async () => {
    const { fromTable, groupedTable, limitedTable } = createLimitedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(limitedTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    let alphaRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["u2", "u3"]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    alphaRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["u1", "u2"]);

    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":22}'::jsonb`)));
    alphaRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u1", rowData: { team: "alpha", value: 1 } },
      { rowIdentifier: "u2", rowData: { team: "alpha", value: 22 } },
    ]);

    await runStatements(fromTable.deleteRow(executionContext, "u1"));
    alphaRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["u2", "u3"]);
  });

  test("limitTable trigger stream reconstructs the same final state as listRowsInGroup", async () => {
    const { fromTable, groupedTable, limitedTable } = createLimitedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(limitedTable.init(executionContext));
    registerLimitAuditTrigger(limitedTable, "limit_change");

    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a4", expr(`'{"team":"alpha","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "a1"));
    await runStatements(fromTable.setRow(executionContext, "a5", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a0", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "a2"));
    await runStatements(fromTable.setRow(executionContext, "a0", expr(`'{"team":"beta","value":100}'::jsonb`)));

    const auditRows = (await readMapTriggerAuditRows())
      .filter((row) => row.event === "limit_change");
    const reconstructed = new Map<string, { groupKey: string | null, rowIdentifier: string, rowData: unknown }>();
    for (const row of auditRows) {
      const groupKey = row.groupKey as string | null;
      const rowIdentifier = String(row.rowIdentifier);
      const key = `${groupKey ?? "__NULL__"}:${rowIdentifier}`;
      if (row.newRowData == null) {
        reconstructed.delete(key);
      } else {
        reconstructed.set(key, { groupKey, rowIdentifier, rowData: row.newRowData });
      }
    }

    const actualRows = (await readRows(limitedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).map((row) => ({
      groupKey: row.groupkey as string | null,
      rowIdentifier: String(row.rowidentifier),
      rowData: row.rowdata,
    }));
    const reconstructedRows = [...reconstructed.values()];
    const sortRows = (rows: Array<{ groupKey: string | null, rowIdentifier: string, rowData: unknown }>) => rows
      .sort((a, b) => stringCompare(
        `${a.groupKey ?? "__NULL__"}:${a.rowIdentifier}:${JSON.stringify(a.rowData)}`,
        `${b.groupKey ?? "__NULL__"}:${b.rowIdentifier}:${JSON.stringify(b.rowData)}`,
      ));
    expect(sortRows(reconstructedRows)).toEqual(sortRows(actualRows));
  });

  test("limitTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, limitedTable } = createLimitedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerLimitAuditTrigger(limitedTable, "limit_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    expect(await readBoolean(limitedTable.isInitialized(executionContext))).toBe(false);
    const groups = await readRows(limitedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
    const limitAuditRows = (await readMapTriggerAuditRows()).filter((row) => row.event === "limit_change");
    expect(limitAuditRows).toEqual([]);
  });

  test("concatTable virtually concatenates grouped inputs and prefixes row identifiers", async () => {
    const { fromTableA, fromTableB, groupedTableA, groupedTableB, concatenatedTable } = createConcatenatedTable();
    await runStatements(fromTableA.init(executionContext));
    await runStatements(fromTableB.init(executionContext));
    await runStatements(groupedTableA.init(executionContext));
    await runStatements(groupedTableB.init(executionContext));

    await runStatements(fromTableA.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTableA.setRow(executionContext, "a2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTableB.setRow(executionContext, "b1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTableB.setRow(executionContext, "b2", expr(`'{"team":"gamma","value":4}'::jsonb`)));

    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(false);
    expect(await readRows(concatenatedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
    await runStatements(concatenatedTable.init(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);

    const groups = await readRows(concatenatedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta", "gamma"]);

    const alphaRows = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows
      .map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))
      .sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier)))
      .toEqual([
        { rowIdentifier: "0:a1", rowData: { team: "alpha", value: 1 } },
        { rowIdentifier: "1:b1", rowData: { team: "alpha", value: 3 } },
      ]);

    const allRows = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRows
      .map((row) => ({
        groupKey: row.groupkey,
        rowIdentifier: row.rowidentifier,
        rowData: row.rowdata,
      }))
      .sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`)))
      .toEqual([
        { groupKey: "alpha", rowIdentifier: "0:a1", rowData: { team: "alpha", value: 1 } },
        { groupKey: "alpha", rowIdentifier: "1:b1", rowData: { team: "alpha", value: 3 } },
        { groupKey: "beta", rowIdentifier: "0:a2", rowData: { team: "beta", value: 2 } },
        { groupKey: "gamma", rowIdentifier: "1:b2", rowData: { team: "gamma", value: 4 } },
      ]);
  });

  test("concatTable forwards prefixed trigger changes from each input table", async () => {
    const { fromTableA, fromTableB, groupedTableA, groupedTableB, concatenatedTable } = createConcatenatedTable();
    await runStatements(fromTableA.init(executionContext));
    await runStatements(fromTableB.init(executionContext));
    await runStatements(groupedTableA.init(executionContext));
    await runStatements(groupedTableB.init(executionContext));
    await runStatements(concatenatedTable.init(executionContext));
    registerConcatAuditTrigger(concatenatedTable, "concat_change");

    await runStatements(fromTableA.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTableB.setRow(executionContext, "b1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTableB.setRow(executionContext, "b1", expr(`'{"team":"gamma","value":5}'::jsonb`)));
    await runStatements(fromTableA.deleteRow(executionContext, "a1"));

    const auditRows = (await readMapTriggerAuditRows())
      .filter((row) => row.event === "concat_change")
      .map((row) => ({
        groupKey: row.groupKey,
        rowIdentifier: row.rowIdentifier,
        oldRowData: row.oldRowData,
        newRowData: row.newRowData,
      }));
    expect(auditRows).toEqual([
      { groupKey: "alpha", rowIdentifier: "0:a1", oldRowData: null, newRowData: { team: "alpha", value: 1 } },
      { groupKey: "beta", rowIdentifier: "1:b1", oldRowData: null, newRowData: { team: "beta", value: 2 } },
      { groupKey: "beta", rowIdentifier: "1:b1", oldRowData: { team: "beta", value: 2 }, newRowData: null },
      { groupKey: "gamma", rowIdentifier: "1:b1", oldRowData: null, newRowData: { team: "gamma", value: 5 } },
      { groupKey: "alpha", rowIdentifier: "0:a1", oldRowData: { team: "alpha", value: 1 }, newRowData: null },
    ]);
  });

  test("concatTable stays virtual but requires its own metadata initialization", async () => {
    const { fromTableA, fromTableB, groupedTableA, groupedTableB, concatenatedTable } = createConcatenatedTable();

    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(false);

    const beforeInitGroups = await readRows(concatenatedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(beforeInitGroups).toEqual([]);

    await runStatements(fromTableA.init(executionContext));
    await runStatements(groupedTableA.init(executionContext));
    await runStatements(fromTableA.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(false);

    const oneSideOnlyRows = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(oneSideOnlyRows).toEqual([]);

    await runStatements(concatenatedTable.init(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);
    const rowsAfterConcatInit = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterConcatInit.map((row) => row.rowidentifier)).toEqual(["0:a1"]);

    await runStatements(fromTableB.init(executionContext));
    await runStatements(groupedTableB.init(executionContext));
    await runStatements(fromTableB.setRow(executionContext, "b1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);

    await runStatements(concatenatedTable.delete(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(false);

    const rowsAfterDelete = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterDelete).toEqual([]);

    await runStatements(concatenatedTable.init(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);

    await runStatements(groupedTableB.delete(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);
    const rowsAfterInputDelete = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterInputDelete.map((row) => row.rowidentifier)).toEqual(["0:a1"]);
  });

  test("concatTable allows input tables with different sort comparators", async () => {
    const fromTableAsc = declareStoredTable<{ value: number, team: string }>({ tableId: "users-concat-sort-asc" });
    const groupedTableAsc = trackTable(declareGroupByTable({
      tableId: "users-concat-sort-asc-by-team",
      fromTable: fromTableAsc,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const sortedTableAsc = trackTable(declareSortTable({
      tableId: "users-concat-sort-asc-sorted",
      fromTable: groupedTableAsc,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    }));

    const fromTableDesc = declareStoredTable<{ value: number, team: string }>({ tableId: "users-concat-sort-desc" });
    const groupedTableDesc = trackTable(declareGroupByTable({
      tableId: "users-concat-sort-desc-by-team",
      fromTable: fromTableDesc,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const sortedTableDesc = trackTable(declareSortTable({
      tableId: "users-concat-sort-desc-sorted",
      fromTable: groupedTableDesc,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${b.sql}) #>> '{}')::int) - (((${a.sql}) #>> '{}')::int)`),
    }));

    const concatenatedTable = trackTable(declareConcatTable({
      tableId: "users-by-team-concat-sort-mismatch",
      tables: [sortedTableAsc, sortedTableDesc],
    }));

    await runStatements(fromTableAsc.init(executionContext));
    await runStatements(groupedTableAsc.init(executionContext));
    await runStatements(sortedTableAsc.init(executionContext));
    await runStatements(fromTableDesc.init(executionContext));
    await runStatements(groupedTableDesc.init(executionContext));
    await runStatements(sortedTableDesc.init(executionContext));

    await runStatements(fromTableAsc.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTableDesc.setRow(executionContext, "b1", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    await runStatements(concatenatedTable.init(executionContext));
    expect(await readBoolean(concatenatedTable.isInitialized(executionContext))).toBe(true);

    const alphaRows = await readRows(concatenatedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["0:a1", "1:b1"]);
  });

  test("sortTable init backfills rows in computed sort order and stores metadata", async () => {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b1", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));

    expect(await readBoolean(sortedTable.isInitialized(executionContext))).toBe(true);
    const groups = await readRows(sortedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(sortedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowSortKey: row.rowsortkey, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a1", rowSortKey: 1, rowData: { team: "alpha", value: 1 } },
      { rowIdentifier: "a2", rowSortKey: 2, rowData: { team: "alpha", value: 2 } },
      { rowIdentifier: "a3", rowSortKey: 3, rowData: { team: "alpha", value: 3 } },
    ]);

    const metadataRows = await sql`
      SELECT 1
      FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:users-by-team-sorted'::text),
        to_jsonb('storage'::text),
        to_jsonb('metadata'::text)
      ]::jsonb[]
    `;
    expect(metadataRows).toHaveLength(1);
  });

  test("sortTable emits insert, update, move, and delete changes with computed sort keys", async () => {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    registerSortAuditTrigger(sortedTable, "sort_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    const auditRows = (await readMapTriggerAuditRows())
      .filter((row) => row.event === "sort_change")
      .map((row) => ({
        groupKey: row.groupKey,
        rowIdentifier: row.rowIdentifier,
        oldRowData: row.oldRowData,
        newRowData: row.newRowData,
      }));
    expect(auditRows).toEqual([
      { groupKey: "alpha", rowIdentifier: "u1", oldRowData: { rowSortKey: null, rowData: null }, newRowData: { rowSortKey: 3, rowData: { team: "alpha", value: 3 } } },
      { groupKey: "alpha", rowIdentifier: "u2", oldRowData: { rowSortKey: null, rowData: null }, newRowData: { rowSortKey: 1, rowData: { team: "alpha", value: 1 } } },
      { groupKey: "alpha", rowIdentifier: "u1", oldRowData: { rowSortKey: 3, rowData: { team: "alpha", value: 3 } }, newRowData: { rowSortKey: 0, rowData: { team: "alpha", value: 0 } } },
      { groupKey: "alpha", rowIdentifier: "u2", oldRowData: { rowSortKey: 1, rowData: { team: "alpha", value: 1 } }, newRowData: { rowSortKey: null, rowData: null } },
      { groupKey: "beta", rowIdentifier: "u2", oldRowData: { rowSortKey: null, rowData: null }, newRowData: { rowSortKey: 1, rowData: { team: "beta", value: 1 } } },
      { groupKey: "alpha", rowIdentifier: "u1", oldRowData: { rowSortKey: 0, rowData: { team: "alpha", value: 0 } }, newRowData: { rowSortKey: null, rowData: null } },
    ]);
  });

  test("sortTable listRowsInGroup supports sort key range filtering", async () => {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u4", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const midRows = await readRows(sortedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr(`to_jsonb(2)`),
      end: expr(`to_jsonb(4)`),
      startInclusive: true,
      endInclusive: false,
    }));
    expect(midRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowSortKey: row.rowsortkey }))).toEqual([
      { rowIdentifier: "u2", rowSortKey: 2 },
      { rowIdentifier: "u3", rowSortKey: 3 },
    ]);
  });

  test("sortTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerSortAuditTrigger(sortedTable, "sort_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    expect(await readBoolean(sortedTable.isInitialized(executionContext))).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "sort_change")).toEqual([]);
    expect(await readRows(sortedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("lFoldTable init backfills flattened rows in deterministic sorted order", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b1", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(lFoldTable.init(executionContext));

    expect(await readBoolean(lFoldTable.isInitialized(executionContext))).toBe(true);
    const groups = await readRows(lFoldTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({
      rowIdentifier: row.rowidentifier,
      rowSortKey: row.rowsortkey,
      rowData: row.rowdata,
    }))).toEqual([
      { rowIdentifier: "a1:1", rowSortKey: 1, rowData: { kind: "running", runningTotal: 1, value: 1 } },
      { rowIdentifier: "a2:1", rowSortKey: 2, rowData: { kind: "running", runningTotal: 3, value: 2 } },
      { rowIdentifier: "a2:2", rowSortKey: 2, rowData: { kind: "even-marker", runningTotal: 3, value: 2 } },
      { rowIdentifier: "a3:1", rowSortKey: 2, rowData: { kind: "running", runningTotal: 5, value: 2 } },
      { rowIdentifier: "a3:2", rowSortKey: 2, rowData: { kind: "even-marker", runningTotal: 5, value: 2 } },
    ]);
  });

  test("lFoldTable recomputes only affected suffix and handles reorder/delete transitions", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(lFoldTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    const beforeTailUpdate = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(beforeTailUpdate.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a1:1", rowData: { kind: "running", runningTotal: 1, value: 1 } },
      { rowIdentifier: "a2:1", rowData: { kind: "running", runningTotal: 4, value: 3 } },
      { rowIdentifier: "a3:1", rowData: { kind: "running", runningTotal: 9, value: 5 } },
    ]);

    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    const afterTailUpdate = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(afterTailUpdate.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a1:1", rowData: { kind: "running", runningTotal: 1, value: 1 } },
      { rowIdentifier: "a2:1", rowData: { kind: "running", runningTotal: 4, value: 3 } },
      { rowIdentifier: "a3:1", rowData: { kind: "running", runningTotal: 10, value: 6 } },
      { rowIdentifier: "a3:2", rowData: { kind: "even-marker", runningTotal: 10, value: 6 } },
    ]);

    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    const afterMiddleMove = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(afterMiddleMove.map((row) => ({ rowIdentifier: row.rowidentifier, rowSortKey: row.rowsortkey, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a2:1", rowSortKey: 0, rowData: { kind: "running", runningTotal: 0, value: 0 } },
      { rowIdentifier: "a2:2", rowSortKey: 0, rowData: { kind: "even-marker", runningTotal: 0, value: 0 } },
      { rowIdentifier: "a1:1", rowSortKey: 1, rowData: { kind: "running", runningTotal: 1, value: 1 } },
      { rowIdentifier: "a3:1", rowSortKey: 6, rowData: { kind: "running", runningTotal: 7, value: 6 } },
      { rowIdentifier: "a3:2", rowSortKey: 6, rowData: { kind: "even-marker", runningTotal: 7, value: 6 } },
    ]);

    await runStatements(fromTable.deleteRow(executionContext, "a1"));
    const afterDelete = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(afterDelete.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a2:1", rowData: { kind: "running", runningTotal: 0, value: 0 } },
      { rowIdentifier: "a2:2", rowData: { kind: "even-marker", runningTotal: 0, value: 0 } },
      { rowIdentifier: "a3:1", rowData: { kind: "running", runningTotal: 6, value: 6 } },
      { rowIdentifier: "a3:2", rowData: { kind: "even-marker", runningTotal: 6, value: 6 } },
    ]);
  });

  test("lFoldTable trigger stream reconstructs exact final table state", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(lFoldTable.init(executionContext));
    registerLFoldAuditTrigger(lFoldTable, "lfold_change");

    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b1", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "a1"));

    const auditRows = (await readMapTriggerAuditRows()).filter((row) => row.event === "lfold_change");
    const reconstructed = new Map<string, { groupKey: string | null, rowIdentifier: string, rowSortKey: unknown, rowData: unknown }>();
    for (const row of auditRows) {
      const groupKey = row.groupKey as string | null;
      const rowIdentifier = String(row.rowIdentifier);
      const key = `${groupKey ?? "__NULL__"}:${rowIdentifier}`;
      const payload = row.newRowData as Record<string, unknown> | null;
      const newRowData = payload == null ? null : Reflect.get(payload, "rowData");
      const newRowSortKey = payload == null ? null : Reflect.get(payload, "rowSortKey");
      if (newRowData == null) {
        reconstructed.delete(key);
      } else {
        reconstructed.set(key, { groupKey, rowIdentifier, rowSortKey: newRowSortKey, rowData: newRowData });
      }
    }

    const actualRows = (await readRows(lFoldTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).map((row) => ({
      groupKey: row.groupkey as string | null,
      rowIdentifier: String(row.rowidentifier),
      rowSortKey: row.rowsortkey,
      rowData: row.rowdata,
    }));
    const reconstructedRows = [...reconstructed.values()];
    const sortRows = (rows: Array<{ groupKey: string | null, rowIdentifier: string, rowSortKey: unknown, rowData: unknown }>) => rows
      .sort((a, b) => stringCompare(
        `${a.groupKey ?? "__NULL__"}:${a.rowIdentifier}:${JSON.stringify(a.rowSortKey)}:${JSON.stringify(a.rowData)}`,
        `${b.groupKey ?? "__NULL__"}:${b.rowIdentifier}:${JSON.stringify(b.rowSortKey)}:${JSON.stringify(b.rowData)}`,
      ));
    expect(sortRows(reconstructedRows)).toEqual(sortRows(actualRows));
  });

  test("lFoldTable uses rowIdentifier as deterministic tie-breaker for equal sort keys", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(lFoldTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "z", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const alphaRows = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a:1", rowData: { kind: "running", runningTotal: 2, value: 2 } },
      { rowIdentifier: "a:2", rowData: { kind: "even-marker", runningTotal: 2, value: 2 } },
      { rowIdentifier: "z:1", rowData: { kind: "running", runningTotal: 4, value: 2 } },
      { rowIdentifier: "z:2", rowData: { kind: "even-marker", runningTotal: 4, value: 2 } },
    ]);
  });

  test("lFoldTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    registerLFoldAuditTrigger(lFoldTable, "lfold_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    expect(await readBoolean(lFoldTable.isInitialized(executionContext))).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "lfold_change")).toEqual([]);
    expect(await readRows(lFoldTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("timeFoldTable init emits rows and enqueues future reductions", async () => {
    const { fromTable, groupedTable, timeFoldTable } = createTimeFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "b1", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(timeFoldTable.init(executionContext));

    expect(await readBoolean(timeFoldTable.isInitialized(executionContext))).toBe(true);
    const alphaRows = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({
      rowIdentifier: String(Reflect.get(row, "rowidentifier") ?? Reflect.get(row, "rowIdentifier")),
      rowData: row.rowdata,
    })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      { rowIdentifier: "a1:1", rowData: { runningTotal: 2, value: 2, timestamp: null } },
      { rowIdentifier: "a2:1", rowData: { runningTotal: 3, value: 3, timestamp: null } },
    ]);

    const queuedRows = await readTimeFoldQueueRows();
    expect(queuedRows).toEqual([
      { rowIdentifier: "a1", groupKey: "alpha", stateAfter: 2, rowData: { team: "alpha", value: 2 } },
      { rowIdentifier: "a2", groupKey: "alpha", stateAfter: 3, rowData: { team: "alpha", value: 3 } },
      { rowIdentifier: "b1", groupKey: "beta", stateAfter: 4, rowData: { team: "beta", value: 4 } },
    ]);
  });

  test("timeFoldTable updates and deletes keep queue rows in sync", async () => {
    const { fromTable, groupedTable, timeFoldTable } = createTimeFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(timeFoldTable.init(executionContext));
    registerTimeFoldAuditTrigger(timeFoldTable, "timefold_change");

    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const queueAfterUpdate = await readTimeFoldQueueRows();
    expect(queueAfterUpdate).toEqual([
      { rowIdentifier: "a1", groupKey: "alpha", stateAfter: 4, rowData: { team: "alpha", value: 4 } },
    ]);

    const auditRows = (await readMapTriggerAuditRows()).filter((row) => row.event === "timefold_change");
    expect(auditRows.map((row) => ({
      rowIdentifier: row.rowIdentifier,
      oldRowData: row.oldRowData,
      newRowData: row.newRowData,
    }))).toEqual([
      {
        rowIdentifier: "a1:1",
        oldRowData: null,
        newRowData: { runningTotal: 1, value: 1, timestamp: null },
      },
      {
        rowIdentifier: "a1:1",
        oldRowData: { runningTotal: 1, value: 1, timestamp: null },
        newRowData: { runningTotal: 4, value: 4, timestamp: null },
      },
    ]);

    await runStatements(fromTable.deleteRow(executionContext, "a1"));
    const rowsAfterDelete = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterDelete).toEqual([]);

    const queueAfterDelete = await sql<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "BulldozerTimeFoldQueue"
    `;
    const queueCountRow = queueAfterDelete[0];
    expect(queueCountRow.count).toBe(0);
  });

  test("timeFoldTable stays no-op while uninitialized", async () => {
    const { fromTable, groupedTable, timeFoldTable } = createTimeFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    registerTimeFoldAuditTrigger(timeFoldTable, "timefold_uninitialized");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":7}'::jsonb`)));

    expect(await readBoolean(timeFoldTable.isInitialized(executionContext))).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "timefold_uninitialized")).toEqual([]);
    expect(await readRows(timeFoldTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
    expect(await readTimeFoldQueueRows()).toEqual([]);
  });

  test("timeFoldTable reruns immediately when reducer timestamp is already due", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-timefold-immediate" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-timefold-immediate-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const timeFoldTable = trackTable(declareTimeFoldTable({
      tableId: "users-timefold-immediate-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        CASE
          WHEN "timestamp" IS NULL THEN 1
          ELSE 2
        END AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'phase',
              CASE
                WHEN "timestamp" IS NULL THEN 'initial'
                ELSE 'rerun'
              END,
            'value', (("oldRowData"->>'value')::int),
            'timestamp',
              CASE
                WHEN "timestamp" IS NULL THEN 'null'::jsonb
                ELSE to_jsonb("timestamp")
              END
          )
        ) AS "newRowsData",
        CASE
          WHEN "timestamp" IS NULL THEN (now() - interval '1 minute')
          ELSE NULL::timestamptz
        END AS "nextTimestamp"
      `),
    }));

    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(timeFoldTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    const alphaRows = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows).toHaveLength(2);
    expect(alphaRows.map((row) => ({
      rowIdentifier: row.rowidentifier,
      rowData: row.rowdata,
    }))).toEqual([
      {
        rowIdentifier: "a1:1",
        rowData: { phase: "initial", value: 5, timestamp: null },
      },
      {
        rowIdentifier: "a1:2",
        rowData: expect.objectContaining({ phase: "rerun", value: 5 }),
      },
    ]);
    const rerunRow = alphaRows[1];
    expect(Reflect.get(rerunRow.rowdata as object, "timestamp")).not.toBeNull();
    expect(await readTimeFoldQueueRows()).toEqual([]);
  });

  test("timeFoldTable does not enqueue when reducer returns null nextTimestamp", async () => {
    const fromTable = declareStoredTable<{ value: number, team: string }>({ tableId: "users-timefold-no-queue" });
    const groupedTable = trackTable(declareGroupByTable({
      tableId: "users-timefold-no-queue-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const timeFoldTable = trackTable(declareTimeFoldTable({
      tableId: "users-timefold-no-queue-folded",
      fromTable: groupedTable,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        ("oldState") AS "newState",
        jsonb_build_array(
          jsonb_build_object(
            'value', (("oldRowData"->>'value')::int),
            'timestamp', 'null'::jsonb
          )
        ) AS "newRowsData",
        NULL::timestamptz AS "nextTimestamp"
      `),
    }));

    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(timeFoldTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":9}'::jsonb`)));

    const alphaRows = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "a1:1", rowData: { value: 9, timestamp: null } },
    ]);
    expect(await readTimeFoldQueueRows()).toEqual([]);
  });

  test("timeFoldTable moving rows across groups replaces queued group entry", async () => {
    const { fromTable, groupedTable, timeFoldTable } = createTimeFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(timeFoldTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":null,"value":7}'::jsonb`)));

    const queueRows = await readTimeFoldQueueRows();
    expect(queueRows).toHaveLength(1);
    const queueRow = queueRows[0];
    expect(queueRow.rowIdentifier).toBe("a1");
    expect(queueRow.groupKey).toBe(null);
    expect(queueRow.rowData).toEqual({ team: null, value: 7 });
    expect(queueRow.stateAfter).toBeGreaterThan(0);

    const alphaRows = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows).toEqual([]);
    const nullGroupRows = await readRows(timeFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`'null'::jsonb`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nullGroupRows).toHaveLength(1);
    const nullGroupRow = nullGroupRows[0];
    expect(nullGroupRow.rowidentifier).toBe("a1:1");
    expect(nullGroupRow.rowdata).toMatchObject({ value: 7, timestamp: null });
  });

  test("leftJoinTable init backfills matches and unmatched left rows per group", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u4", expr(`'{"team":"alpha","value":7}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":1,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r2", expr(`'{"team":"alpha","threshold":5,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r3", expr(`'{"team":"beta","threshold":2,"label":"vip"}'::jsonb`)));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    await runStatements(leftJoinedTable.init(executionContext));

    expect(await readBoolean(leftJoinedTable.isInitialized(executionContext))).toBe(true);
    const groups = await readRows(leftJoinedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      {
        rowIdentifier: `["u1", "r2"]`,
        rowData: {
          leftRowData: { team: "alpha", value: 5 },
          rightRowData: { team: "alpha", threshold: 5, label: "gold" },
        },
      },
      {
        rowIdentifier: `["u2", "r1"]`,
        rowData: {
          leftRowData: { team: "alpha", value: 1 },
          rightRowData: { team: "alpha", threshold: 1, label: "silver" },
        },
      },
      {
        rowIdentifier: `["u4", null]`,
        rowData: {
          leftRowData: { team: "alpha", value: 7 },
          rightRowData: null,
        },
      },
    ]);

    const betaRows = await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('beta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(betaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      {
        rowIdentifier: `["u3", "r3"]`,
        rowData: {
          leftRowData: { team: "beta", value: 2 },
          rightRowData: { team: "beta", threshold: 2, label: "vip" },
        },
      },
    ]);
  });

  test("leftJoinTable matches null join keys with IS NOT DISTINCT FROM semantics", async () => {
    const fromTable = declareStoredTable<{ value: number | null, team: string | null }>({ tableId: "left-join-null-users" });
    const joinTable = declareStoredTable<{ threshold: number | null, team: string | null, label: string }>({ tableId: "left-join-null-rules" });
    const groupedFromTable = trackTable(declareGroupByTable({
      tableId: "left-join-null-users-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const groupedJoinTable = trackTable(declareGroupByTable({
      tableId: "left-join-null-rules-by-team",
      fromTable: joinTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const leftJoinedTable = trackTable(declareLeftJoinTable({
      tableId: "left-join-null-users-rules",
      leftTable: groupedFromTable,
      rightTable: groupedJoinTable,
      leftJoinKey: mapper(`"rowData"->'value' AS "joinKey"`),
      rightJoinKey: mapper(`"rowData"->'threshold' AS "joinKey"`),
    }));

    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    await runStatements(leftJoinedTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u-null", expr(`'{"team":"alpha","value":null}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u-num", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r-null", expr(`'{"team":"alpha","threshold":null,"label":"null-match"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r-num", expr(`'{"team":"alpha","threshold":3,"label":"num-match"}'::jsonb`)));

    const alphaRows = await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));

    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      {
        rowIdentifier: `["u-null", "r-null"]`,
        rowData: {
          leftRowData: { team: "alpha", value: null },
          rightRowData: { team: "alpha", threshold: null, label: "null-match" },
        },
      },
      {
        rowIdentifier: `["u-num", "r-num"]`,
        rowData: {
          leftRowData: { team: "alpha", value: 3 },
          rightRowData: { team: "alpha", threshold: 3, label: "num-match" },
        },
      },
    ]);
  });

  test("leftJoinTable recomputes touched groups when either input table changes", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    await runStatements(leftJoinedTable.init(executionContext));

    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":2,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r2", expr(`'{"team":"alpha","threshold":4,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "rb1", expr(`'{"team":"beta","threshold":3,"label":"beta-rule"}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":4}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":6,"label":"silver"}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":5}'::jsonb`)));
    await runStatements(joinTable.deleteRow(executionContext, "rb1"));
    await runStatements(fromTable.deleteRow(executionContext, "u3"));
    await runStatements(fromTable.deleteRow(executionContext, "u2"));

    const groups = await readRows(leftJoinedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey)).toEqual(["beta"]);

    const betaRows = await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('beta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(betaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      {
        rowIdentifier: `["u1", null]`,
        rowData: {
          leftRowData: { team: "beta", value: 5 },
          rightRowData: null,
        },
      },
    ]);
  });

  test("leftJoinTable listRowsInGroup is deterministically ordered by rowIdentifier", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    await runStatements(leftJoinedTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r2", expr(`'{"team":"alpha","threshold":5,"label":"rule-2"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":5,"label":"rule-1"}'::jsonb`)));

    const alphaRows = await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual([
      `["u1", "r1"]`,
      `["u1", "r2"]`,
      `["u2", "r1"]`,
      `["u2", "r2"]`,
    ]);
  });

  test("sortTable bulk init respects descending comparator", async () => {
    const { fromTable, groupedTable, sortedTable } = createDescendingSortedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));

    const alphaRows = await readRows(sortedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["a3", "a2", "a1"]);
  });

  test("limitTable honors source comparator for top-N", async () => {
    const { fromTable, groupedTable, sortedTable, limitedTable } = createDescendingLimitedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(limitedTable.init(executionContext));

    const alphaRows = await readRows(limitedTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["a3", "a2"]);
  });

  test("lFoldTable read order matches source comparator", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createDescendingLFoldTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(sortedTable.init(executionContext));
    await runStatements(lFoldTable.init(executionContext));

    const alphaRows = await readRows(lFoldTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["a3:1", "a2:1", "a1:1"]);
  });

  test("leftJoinTable trigger stream reconstructs exact final table state", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    await runStatements(leftJoinedTable.init(executionContext));
    registerLeftJoinAuditTrigger(leftJoinedTable, "left_join_change");

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"beta","value":7}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":3,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r2", expr(`'{"team":"alpha","threshold":5,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r3", expr(`'{"team":"beta","threshold":6,"label":"beta"}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"beta","value":8}'::jsonb`)));
    await runStatements(joinTable.deleteRow(executionContext, "r2"));
    await runStatements(fromTable.deleteRow(executionContext, "u3"));

    const auditRows = (await readMapTriggerAuditRows()).filter((row) => row.event === "left_join_change");
    const reconstructed = new Map<string, { groupKey: string | null, rowIdentifier: string, rowData: unknown }>();
    for (const row of auditRows) {
      const groupKey = row.groupKey as string | null;
      const rowIdentifier = String(row.rowIdentifier);
      const key = `${groupKey ?? "__NULL__"}:${rowIdentifier}`;
      if (row.newRowData == null) {
        reconstructed.delete(key);
      } else {
        reconstructed.set(key, { groupKey, rowIdentifier, rowData: row.newRowData });
      }
    }

    const actualRows = (await readRows(leftJoinedTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).map((row) => ({
      groupKey: row.groupkey as string | null,
      rowIdentifier: String(row.rowidentifier),
      rowData: row.rowdata,
    }));
    const reconstructedRows = [...reconstructed.values()];
    const sortRows = (rows: Array<{ groupKey: string | null, rowIdentifier: string, rowData: unknown }>) => rows
      .sort((a, b) => stringCompare(
        `${a.groupKey ?? "__NULL__"}:${a.rowIdentifier}:${JSON.stringify(a.rowData)}`,
        `${b.groupKey ?? "__NULL__"}:${b.rowIdentifier}:${JSON.stringify(b.rowData)}`,
      ));
    expect(sortRows(reconstructedRows)).toEqual(sortRows(actualRows));
  });

  test("leftJoinTable stays no-op while uninitialized", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init(executionContext));
    await runStatements(joinTable.init(executionContext));
    await runStatements(groupedFromTable.init(executionContext));
    await runStatements(groupedJoinTable.init(executionContext));
    registerLeftJoinAuditTrigger(leftJoinedTable, "left_join_change");
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(joinTable.setRow(executionContext, "r1", expr(`'{"team":"alpha","threshold":2,"label":"silver"}'::jsonb`)));

    expect(await readBoolean(leftJoinedTable.isInitialized(executionContext))).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "left_join_change")).toEqual([]);
    expect(await readRows(leftJoinedTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("flatMap -> map -> groupBy composition stays consistent across updates", async () => {
    const { fromTable, groupedTable, flatMappedTable, mappedAfterFlatMap, groupedByKind } = createFlatMapMapGroupPipeline();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(flatMappedTable.init(executionContext));
    await runStatements(mappedAfterFlatMap.init(executionContext));
    await runStatements(groupedByKind.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":-1}'::jsonb`)));

    const groups = await readRows(groupedByKind.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["base", "double"]);

    const baseRows = await readRows(groupedByKind.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('base'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(baseRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u2:1:1", rowData: { team: "beta", kind: "base", mappedValuePlusOne: 103 } },
    ]);

    const doubleRows = await readRows(groupedByKind.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('double'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(doubleRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u2:2:1", rowData: { team: "beta", kind: "double", mappedValuePlusOne: 5 } },
    ]);
  });

  test("stacked map tables propagate updates across multiple mapping layers", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const groupsAfterMove = await readRows(mappedTableLevel2.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["alpha"]);

    const alphaRows = await readRows(mappedTableLevel2.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      { rowIdentifier: "u1:1:1", rowData: { team: "alpha", valueScaled: 30, bucket: "high" } },
      { rowIdentifier: "u2:1:1", rowData: { team: "alpha", valueScaled: 28, bucket: "low" } },
    ]);

    await runStatements(fromTable.deleteRow(executionContext, "u1"));
    const alphaRowsAfterDelete = await readRows(mappedTableLevel2.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRowsAfterDelete.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u2:1:1", rowData: { team: "alpha", valueScaled: 28, bucket: "low" } },
    ]);
  });

  test("stacked map tables handle special row identifiers and null group transitions", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));

    const specialIdentifier = "user/one:two space";
    await runStatements(fromTable.setRow(executionContext, specialIdentifier, expr(`'{"team":null,"value":3}'::jsonb`)));

    const nullGroupRows = await readRows(mappedTableLevel2.listRowsInGroup(executionContext, {
      groupKey: expr(`'null'::jsonb`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nullGroupRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: `${specialIdentifier}:1:1`, rowData: { team: null, valueScaled: 26, bucket: "low" } },
    ]);

    await runStatements(fromTable.setRow(executionContext, specialIdentifier, expr(`'{"team":"alpha","value":3}'::jsonb`)));
    const groupsAfterMove = await readRows(mappedTableLevel2.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  test("stacked map tables backfill correctly with staggered initialization order", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));

    await runStatements(mappedTableLevel2.init(executionContext));
    const allRowsAfterInit = await readRows(mappedTableLevel2.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allRowsAfterInit.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "alpha", rowIdentifier: "u1:1:1", rowData: { team: "alpha", valueScaled: 22, bucket: "low" } },
      { groupKey: "alpha", rowIdentifier: "u3:1:1", rowData: { team: "alpha", valueScaled: 26, bucket: "low" } },
      { groupKey: "beta", rowIdentifier: "u2:1:1", rowData: { team: "beta", valueScaled: 24, bucket: "low" } },
    ]);

    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    const betaRows = await readRows(mappedTableLevel2.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('beta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(betaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u2:1:1", rowData: { team: "beta", valueScaled: 60, bucket: "high" } },
    ]);
  });

  test("groupBy over a stacked map table stays consistent on mapped key transitions", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2, groupedByBucketTable } = createGroupMapGroupPipeline();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));
    await runStatements(groupedByBucketTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"gamma","value":2}'::jsonb`)));

    const initialGroups = await readRows(groupedByBucketTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(initialGroups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["high", "low"]);

    const lowRows = await readRows(groupedByBucketTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('low'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(lowRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["u1:1:1", "u3:1:1"]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":30}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u3"));

    const finalGroups = await readRows(groupedByBucketTable.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(finalGroups.map((row) => row.groupkey)).toEqual(["high"]);

    const highRows = await readRows(groupedByBucketTable.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('high'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(highRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["u1:1:1", "u2:1:1"]);
  });

  test("composed trigger fanout works for stacked map and downstream groupBy tables", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2, groupedByBucketTable } = createGroupMapGroupPipeline();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));
    await runStatements(groupedByBucketTable.init(executionContext));

    mappedTableLevel2.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerMapTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral("map_level_2_change"))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);
    groupedByBucketTable.registerRowChangeTrigger((_ctx, changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => [
      sqlStatement`
        INSERT INTO "BulldozerGroupTriggerAudit" (
          "event",
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        )
        SELECT
          ${expr<string>(sqlStringLiteral("bucket_group_change"))},
          "groupKey",
          "rowIdentifier",
          "oldRowData",
          "newRowData"
        FROM ${changesTable}
      `,
    ]);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":30}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u1"));

    expect(await readMapTriggerAuditRows()).toEqual([
      {
        event: "map_level_2_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1:1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
      },
      {
        event: "map_level_2_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1:1",
        oldRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
        newRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
      },
      {
        event: "map_level_2_change",
        groupKey: "alpha",
        rowIdentifier: "u1:1:1",
        oldRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
        newRowData: null,
      },
    ]);
    expect(await readGroupTriggerAuditRows()).toEqual([
      {
        event: "bucket_group_change",
        groupKey: "low",
        rowIdentifier: "u1:1:1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
      },
      {
        event: "bucket_group_change",
        groupKey: "low",
        rowIdentifier: "u1:1:1",
        oldRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
        newRowData: null,
      },
      {
        event: "bucket_group_change",
        groupKey: "high",
        rowIdentifier: "u1:1:1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
      },
      {
        event: "bucket_group_change",
        groupKey: "high",
        rowIdentifier: "u1:1:1",
        oldRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
        newRowData: null,
      },
    ]);
  });

  test("deep pipeline delete and re-init restores exact source truth", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2, groupedByBucketTable } = createGroupMapGroupPipeline();
    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));
    await runStatements(groupedByBucketTable.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u3", expr(`'{"team":"gamma","value":2}'::jsonb`)));

    await runStatements(groupedByBucketTable.delete(executionContext));
    await runStatements(mappedTableLevel2.delete(executionContext));
    await runStatements(mappedTableLevel1.delete(executionContext));

    expect(await readBoolean(mappedTableLevel1.isInitialized(executionContext))).toBe(false);
    expect(await readBoolean(mappedTableLevel2.isInitialized(executionContext))).toBe(false);
    expect(await readBoolean(groupedByBucketTable.isInitialized(executionContext))).toBe(false);

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u2"));
    await runStatements(fromTable.setRow(executionContext, "u4", expr(`'{"team":"delta","value":0}'::jsonb`)));

    await runStatements(mappedTableLevel1.init(executionContext));
    await runStatements(mappedTableLevel2.init(executionContext));
    await runStatements(groupedByBucketTable.init(executionContext));

    const allBucketRows = await readRows(groupedByBucketTable.listRowsInGroup(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(allBucketRows.map((row) => ({ groupKey: row.groupkey, rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(`${a.groupKey}:${a.rowIdentifier}`, `${b.groupKey}:${b.rowIdentifier}`))).toEqual([
      { groupKey: "high", rowIdentifier: "u1:1:1", rowData: { team: "alpha", valueScaled: 30, bucket: "high" } },
      { groupKey: "low", rowIdentifier: "u3:1:1", rowData: { team: "gamma", valueScaled: 24, bucket: "low" } },
      { groupKey: "low", rowIdentifier: "u4:1:1", rowData: { team: "delta", valueScaled: 20, bucket: "low" } },
    ]);
  });

  test("parallel map tables on the same grouped source stay isolated", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    const mapTableA = trackTable(declareMapTable({
      tableId: "users-map-a",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 100) AS "mappedValueA"
      `),
    }));
    const mapTableB = trackTable(declareMapTable({
      tableId: "users-map-b",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        ((("rowData"->>'value')::int) * -1) AS "mappedValueB"
      `),
    }));

    await runStatements(fromTable.init(executionContext));
    await runStatements(groupedTable.init(executionContext));
    await runStatements(mapTableA.init(executionContext));
    await runStatements(mapTableB.init(executionContext));

    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u2", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    await runStatements(fromTable.deleteRow(executionContext, "u2"));

    const alphaRowsA = await readRows(mapTableA.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRowsA.map((row) => row.rowdata)).toEqual([{ team: "alpha", mappedValueA: 106 }]);

    const alphaRowsB = await readRows(mapTableB.listRowsInGroup(executionContext, {
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRowsB.map((row) => row.rowdata)).toEqual([{ team: "alpha", mappedValueB: -6 }]);

    const groupsA = await readRows(mapTableA.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const groupsB = await readRows(mapTableB.listGroups(executionContext, {
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsA.map((row) => row.groupkey)).toEqual(["alpha"]);
    expect(groupsB.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  // ============================================================
  // CompactTable tests
  // ============================================================

  function createCompactTableSetup() {
    const entries = declareStoredTable<{ itemId: string, quantity: number, t: number }>({
      tableId: "compact-test-entries",
    });
    const boundaries = declareStoredTable<{ t: number }>({
      tableId: "compact-test-boundaries",
    });
    const entriesSorted = trackTable(declareSortTable({
      tableId: "compact-test-entries-sorted",
      fromTable: entries,
      getSortKey: mapper(`(("rowData"->>'t')::numeric) AS "newSortKey"`),
      compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
    }));
    const boundariesSorted = trackTable(declareSortTable({
      tableId: "compact-test-boundaries-sorted",
      fromTable: boundaries,
      getSortKey: mapper(`(("rowData"->>'t')::numeric) AS "newSortKey"`),
      compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
    }));
    const compacted = trackTable(declareCompactTable({
      tableId: "compact-test-compacted",
      toBeCompactedTable: entriesSorted,
      boundaryTable: boundariesSorted,
      orderingKey: "t",
      compactKey: "quantity",
      partitionKey: "itemId",
    }));
    return { entries, boundaries, entriesSorted, boundariesSorted, compacted };
  }

  test("compactTable merges consecutive entries in a single window", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));

    const rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.itemId).toBe("a");
    expect(rows[0].rowdata.quantity).toBe(15);
    expect(rows[0].rowdata.t).toBe(1);
  });

  test("compactTable splits windows at boundaries", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));
    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":3}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e3", expr(`'{"itemId":"a","quantity":20,"t":4}'::jsonb`)));

    const rows = (await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => ({ itemId: r.rowdata.itemId, quantity: r.rowdata.quantity, t: r.rowdata.t }))
      .sort((a: any, b: any) => a.t - b.t);

    expect(rows).toEqual([
      { itemId: "a", quantity: 15, t: 1 },
      { itemId: "a", quantity: 20, t: 4 },
    ]);
  });

  test("compactTable handles multiple partitions in same window", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"b","quantity":5,"t":2}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e3", expr(`'{"itemId":"a","quantity":3,"t":3}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e4", expr(`'{"itemId":"b","quantity":7,"t":4}'::jsonb`)));
    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":5}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e5", expr(`'{"itemId":"b","quantity":2,"t":6}'::jsonb`)));

    const rows = (await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => ({ itemId: r.rowdata.itemId, quantity: r.rowdata.quantity, t: r.rowdata.t }))
      .sort((a: any, b: any) => a.t - b.t);

    expect(rows).toEqual([
      { itemId: "a", quantity: 13, t: 1 },
      { itemId: "b", quantity: 12, t: 2 },
      { itemId: "b", quantity: 2, t: 6 },
    ]);
  });

  test("compactTable single entry passes through as compacted row", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"x","quantity":42,"t":1}'::jsonb`)));

    const rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata).toEqual({ itemId: "x", quantity: 42, t: 1 });
  });

  test("compactTable empty inputs produce empty output", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    const rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(0);
  });

  test("compactTable recomputes when entry is added", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    let rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.quantity).toBe(10);

    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));
    rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.quantity).toBe(15);
  });

  test("compactTable recomputes when boundary is added splitting a window", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":3}'::jsonb`)));

    let rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.quantity).toBe(15);

    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":2}'::jsonb`)));

    rows = (await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .sort((a: any, b: any) => a.rowdata.t - b.rowdata.t);
    expect(rows).toHaveLength(2);
    expect(rows[0].rowdata.quantity).toBe(10);
    expect(rows[1].rowdata.quantity).toBe(5);
  });

  test("compactTable recomputes when entry is deleted", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e3", expr(`'{"itemId":"a","quantity":20,"t":3}'::jsonb`)));

    let rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.quantity).toBe(35);

    await runStatements(entries.deleteRow(executionContext, "e2"));

    rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.quantity).toBe(30);
  });

  test("compactTable does not pass through boundary rows", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":5}'::jsonb`)));
    await runStatements(boundaries.setRow(executionContext, "b2", expr(`'{"t":10}'::jsonb`)));

    const rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(0);
  });

  test("compactTable recomputes when boundary is deleted (merges previously-split windows)", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":3}'::jsonb`)));
    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":2}'::jsonb`)));

    // With boundary at t=2: two windows → two compacted rows
    let rows = (await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .sort((a: any, b: any) => a.rowdata.t - b.rowdata.t);
    expect(rows).toHaveLength(2);
    expect(rows[0].rowdata).toEqual({ itemId: "a", quantity: 10, t: 1 });
    expect(rows[1].rowdata).toEqual({ itemId: "a", quantity: 5, t: 3 });

    // Delete boundary → windows merge back into one
    await runStatements(boundaries.deleteRow(executionContext, "b1"));

    rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata).toEqual({ itemId: "a", quantity: 15, t: 1 });
  });

  test("compactTable with multiple boundaries produces multiple compacted rows per partition", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    // Window 1 (t < 10): entries at t=1,2,3
    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e3", expr(`'{"itemId":"b","quantity":7,"t":3}'::jsonb`)));
    // Boundary at t=10
    await runStatements(boundaries.setRow(executionContext, "b1", expr(`'{"t":10}'::jsonb`)));
    // Window 2 (10 <= t < 20): entries at t=11,12
    await runStatements(entries.setRow(executionContext, "e4", expr(`'{"itemId":"a","quantity":20,"t":11}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e5", expr(`'{"itemId":"a","quantity":3,"t":12}'::jsonb`)));
    // Boundary at t=20
    await runStatements(boundaries.setRow(executionContext, "b2", expr(`'{"t":20}'::jsonb`)));
    // Window 3 (t >= 20): entries at t=21,22
    await runStatements(entries.setRow(executionContext, "e6", expr(`'{"itemId":"a","quantity":100,"t":21}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e7", expr(`'{"itemId":"b","quantity":50,"t":22}'::jsonb`)));

    const rows = (await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => ({ itemId: r.rowdata.itemId, quantity: r.rowdata.quantity, t: r.rowdata.t }))
      .sort((a: any, b: any) => a.t - b.t || stringCompare(a.itemId, b.itemId));

    expect(rows).toEqual([
      // Window 1: a(10+5)=15, b(7)=7
      { itemId: "a", quantity: 15, t: 1 },
      { itemId: "b", quantity: 7, t: 3 },
      // Window 2: a(20+3)=23
      { itemId: "a", quantity: 23, t: 11 },
      // Window 3: a(100)=100, b(50)=50
      { itemId: "a", quantity: 100, t: 21 },
      { itemId: "b", quantity: 50, t: 22 },
    ]);
  });

  test("compactTable preserves first row's data for non-compactKey fields", async () => {
    const { entries, boundaries, entriesSorted, boundariesSorted, compacted } = createCompactTableSetup();
    await runStatements(entries.init(executionContext));
    await runStatements(boundaries.init(executionContext));
    await runStatements(entriesSorted.init(executionContext));
    await runStatements(boundariesSorted.init(executionContext));
    await runStatements(compacted.init(executionContext));

    await runStatements(entries.setRow(executionContext, "e1", expr(`'{"itemId":"a","quantity":10,"t":1}'::jsonb`)));
    await runStatements(entries.setRow(executionContext, "e2", expr(`'{"itemId":"a","quantity":5,"t":2}'::jsonb`)));

    const rows = await readRows(compacted.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.t).toBe(1);
    expect(rows[0].rowdata.itemId).toBe("a");
  });

  // ============================================================
  // ReduceTable tests
  // ============================================================

  // Helper: sum reducer (sums "value" field into state number)
  function createSumReduceSetup() {
    const source = declareStoredTable<{ team: string, value: number }>({
      tableId: "reduce-test-source",
    });
    const grouped = trackTable(declareGroupByTable({
      tableId: "reduce-test-grouped",
      fromTable: source,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const reduced = trackTable(declareReduceTable({
      tableId: "reduce-test-sum",
      fromTable: grouped,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        to_jsonb(
          COALESCE(("oldState" #>> '{}')::numeric, 0)
          + COALESCE(("oldRowData"->>'value')::numeric, 0)
        ) AS "newState"
      `),
      finalize: mapper(`
        "groupKey" AS "team",
        ("state" #>> '{}')::numeric AS "total"
      `),
    }));
    return { source, grouped, reduced };
  }

  // Helper: array-accumulating reducer (appends to jsonb array)
  function createArrayReduceSetup() {
    const source = declareStoredTable<{ category: string, label: string, t: number }>({
      tableId: "reduce-test-arr-source",
    });
    const grouped = trackTable(declareGroupByTable({
      tableId: "reduce-test-arr-grouped",
      fromTable: source,
      groupBy: mapper(`"rowData"->'category' AS "groupKey"`),
    }));
    const sorted = trackTable(declareSortTable({
      tableId: "reduce-test-arr-sorted",
      fromTable: grouped,
      getSortKey: mapper(`(("rowData"->>'t')::numeric) AS "newSortKey"`),
      compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
    }));
    const reduced = trackTable(declareReduceTable({
      tableId: "reduce-test-arr",
      fromTable: sorted,
      initialState: expr(`'[]'::jsonb`),
      reducer: mapper(`
        ("oldState" || jsonb_build_array("oldRowData"->'label')) AS "newState"
      `),
      finalize: mapper(`
        "groupKey" AS "category",
        "state" AS "labels"
      `),
    }));
    return { source, grouped, sorted, reduced };
  }

  test("reduceTable produces one row per group with summed values", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u3", expr(`'{"team":"beta","value":7}'::jsonb`)));

    const rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));

    expect(rows).toEqual([
      { team: "alpha", total: 15 },
      { team: "beta", total: 7 },
    ]);
  });

  test("reduceTable preserves input group key", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7}'::jsonb`)));

    const groups = (await readRows(reduced.listGroups(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.groupkey)
      .sort((a: string, b: string) => stringCompare(a, b));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toBe("alpha");
    expect(groups[1]).toBe("beta");
  });

  test("reduceTable finalize embeds groupKey as row attributes", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));

    const rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.team).toBe("alpha");
  });

  test("reduceTable with array-accumulating reducer preserves sort order", async () => {
    const { source, grouped, sorted, reduced } = createArrayReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(sorted.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "a3", expr(`'{"category":"fruits","label":"cherry","t":3}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "a1", expr(`'{"category":"fruits","label":"apple","t":1}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "a2", expr(`'{"category":"fruits","label":"banana","t":2}'::jsonb`)));

    const rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.category).toBe("fruits");
    expect(rows[0].rowdata.labels).toEqual(["apple", "banana", "cherry"]);
  });

  test("reduceTable on ungrouped input folds all rows into one output", async () => {
    const source = declareStoredTable<{ value: number }>({
      tableId: "reduce-test-ungrouped-source",
    });
    const reduced = trackTable(declareReduceTable({
      tableId: "reduce-test-ungrouped",
      fromTable: source,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        to_jsonb(
          COALESCE(("oldState" #>> '{}')::numeric, 0)
          + COALESCE(("oldRowData"->>'value')::numeric, 0)
        ) AS "newState"
      `),
      finalize: mapper(`
        ("state" #>> '{}')::numeric AS "total"
      `),
    }));
    await runStatements(source.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "r1", expr(`'{"value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r2", expr(`'{"value":5}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r3", expr(`'{"value":3}'::jsonb`)));

    const rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.total).toBe(18);
  });

  test("reduceTable empty input produces no output", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    const rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(0);
  });

  test("reduceTable recomputes when row is added", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    let rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.total).toBe(10);

    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata.total).toBe(15);
  });

  test("reduceTable recomputes when row is updated", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    let rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.total).toBe(15);

    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":20}'::jsonb`)));
    rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.total).toBe(30);
  });

  test("reduceTable recomputes when row is deleted", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));

    let rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.total).toBe(18);

    await runStatements(source.deleteRow(executionContext, "u2"));
    rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows[0].rowdata.total).toBe(13);
  });

  test("reduceTable removes output when group becomes empty", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    let rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(1);

    await runStatements(source.deleteRow(executionContext, "u1"));
    rows = await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(rows).toHaveLength(0);
  });

  test("reduceTable passes through single-row groups as grouped output", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":42}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u3", expr(`'{"team":"gamma","value":99}'::jsonb`)));

    const rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));

    expect(rows).toEqual([
      { team: "alpha", total: 42 },
      { team: "beta", total: 7 },
      { team: "gamma", total: 99 },
    ]);

    const groups = await readRows(reduced.listGroups(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    expect(groups).toHaveLength(3);
    expect(groups[0].groupkey).toBe("alpha");
  });

  test("reduceTable handles row moving between groups", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7}'::jsonb`)));

    let rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));
    expect(rows).toEqual([
      { team: "alpha", total: 10 },
      { team: "beta", total: 7 },
    ]);

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"beta","value":10}'::jsonb`)));

    rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));
    expect(rows).toEqual([
      { team: "beta", total: 17 },
    ]);
  });

  test("toExecutableSqlTransaction handles empty statements", async () => {
    await runStatements([]);
  });

  test("toExecutableSqlTransaction handles multi-command outputless statements with dollar-quoted function bodies", async () => {
    await runStatements([{
      type: "statement",
      sql: `
        CREATE OR REPLACE FUNCTION pg_temp.bulldozer_test_jsonb_get(input jsonb)
        RETURNS text LANGUAGE sql AS $$
          SELECT input->>'id'
        $$;

        CREATE TEMP TABLE IF NOT EXISTS "BulldozerTransactionProbe" (
          "value" text NOT NULL
        );

        TRUNCATE TABLE "BulldozerTransactionProbe";

        INSERT INTO "BulldozerTransactionProbe" ("value")
        VALUES (pg_temp.bulldozer_test_jsonb_get('{"id":"abc"}'::jsonb));
      `,
    }]);

    const rows = await sql.unsafe(`
      SELECT "value"
      FROM "BulldozerTransactionProbe"
    `);
    expect(rows).toEqual([{ value: "abc" }]);
  });

  test("row-change dispatch stays below 1000 statements for 34-table mixed graph", () => {
    const source = declareStoredTable<{ team: string | null, value: number }>({
      tableId: "statement-budget-source",
    });

    const firstMapTable = declareMapTable({
      tableId: "statement-budget-map-0",
      fromTable: source,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 1) AS "value"
      `),
    });
    const mapTables = [firstMapTable];
    let currentMappedTable = firstMapTable;
    for (let i = 1; i < 10; i++) {
      const mappedTable = declareMapTable({
        tableId: `statement-budget-map-${i}`,
        fromTable: currentMappedTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          (("rowData"->>'value')::int + ${i + 1}) AS "value"
        `),
      });
      mapTables.push(mappedTable);
      currentMappedTable = mappedTable;
    }

    const mapConcat = declareConcatTable({
      tableId: "statement-budget-map-concat",
      tables: mapTables,
    });

    const firstFilterTable = declareFilterTable({
      tableId: "statement-budget-filter-0",
      fromTable: mapConcat,
      filter: predicate(`(("rowData"->>'value')::int % 2) = 0::int`),
    });
    const filterTables = [firstFilterTable];
    let currentFilteredTable = firstFilterTable;
    for (let i = 1; i < 10; i++) {
      const filteredTable = declareFilterTable({
        tableId: `statement-budget-filter-${i}`,
        fromTable: currentFilteredTable,
        filter: predicate(`(("rowData"->>'value')::int % 2) = ${(i % 2)}::int`),
      });
      filterTables.push(filteredTable);
      currentFilteredTable = filteredTable;
    }

    const lastFilter = filterTables[filterTables.length - 1] ?? (() => {
      throw new Error("expected last filter table");
    })();
    const leftJoinedTable = declareLeftJoinTable({
      tableId: "statement-budget-left-join",
      leftTable: lastFilter,
      rightTable: mapConcat,
      leftJoinKey: mapper(`"rowData"->'value' AS "joinKey"`),
      rightJoinKey: mapper(`"rowData"->'value' AS "joinKey"`),
    });

    const firstFlatMap = declareFlatMapTable({
      tableId: "statement-budget-flat-map-0",
      fromTable: leftJoinedTable,
      mapper: mapper(`
        jsonb_build_array(
          jsonb_build_object(
            'team', "rowData"->'leftRowData'->'team',
            'value', (("rowData"->'leftRowData'->>'value')::int)
          )
        ) AS "rows"
      `),
    });
    const flatMapTables = [firstFlatMap];
    let currentFlatMapTable = firstFlatMap;
    for (let i = 1; i < 10; i++) {
      const flatMappedTable = declareFlatMapTable({
        tableId: `statement-budget-flat-map-${i}`,
        fromTable: currentFlatMapTable,
        mapper: mapper(`
          jsonb_build_array(
            jsonb_build_object(
              'team', "rowData"->'team',
              'value', (("rowData"->>'value')::int + ${i})
            )
          ) AS "rows"
        `),
      });
      flatMapTables.push(flatMappedTable);
      currentFlatMapTable = flatMappedTable;
    }

    const finalConcat = declareConcatTable({
      tableId: "statement-budget-final-concat",
      tables: flatMapTables,
    });

    const totalTableCount =
      1
      + mapTables.length
      + 1
      + filterTables.length
      + 1
      + flatMapTables.length
      + 1;
    expect(totalTableCount).toBe(34);
    expect(finalConcat.inputTables).toHaveLength(10);

    const statements = source.setRow(executionContext, "budget-row", expr(`'{"team":"alpha","value":5}'::jsonb`));
    expect(statements.length).toBeLessThan(1000);
  });

  test("reduceTable handles null group key", async () => {
    const source = declareStoredTable<{ team: string | null, value: number }>({
      tableId: "reduce-test-null-gk-source",
    });
    const grouped = trackTable(declareGroupByTable({
      tableId: "reduce-test-null-gk-grouped",
      fromTable: source,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    }));
    const reduced = trackTable(declareReduceTable({
      tableId: "reduce-test-null-gk",
      fromTable: grouped,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        to_jsonb(
          COALESCE(("oldState" #>> '{}')::numeric, 0)
          + COALESCE(("oldRowData"->>'value')::numeric, 0)
        ) AS "newState"
      `),
      finalize: mapper(`
        "groupKey" AS "team",
        ("state" #>> '{}')::numeric AS "total"
      `),
    }));
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":null,"value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":null,"value":5}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":7}'::jsonb`)));

    const rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(String(a.team), String(b.team)));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ team: "alpha", total: 7 });
    expect(rows[1]).toEqual({ team: null, total: 15 });
  });

  test("reduceTable handles complex object group key", async () => {
    const source = declareStoredTable<{ tenancyId: string, customerId: string, value: number }>({
      tableId: "reduce-test-complex-gk-source",
    });
    const grouped = trackTable(declareGroupByTable({
      tableId: "reduce-test-complex-gk-grouped",
      fromTable: source,
      groupBy: mapper(`
        jsonb_build_object(
          'tenancyId', "rowData"->'tenancyId',
          'customerId', "rowData"->'customerId'
        ) AS "groupKey"
      `),
    }));
    const reduced = trackTable(declareReduceTable({
      tableId: "reduce-test-complex-gk",
      fromTable: grouped,
      initialState: expr(`'0'::jsonb`),
      reducer: mapper(`
        to_jsonb(
          COALESCE(("oldState" #>> '{}')::numeric, 0)
          + COALESCE(("oldRowData"->>'value')::numeric, 0)
        ) AS "newState"
      `),
      finalize: mapper(`
        "groupKey"->'tenancyId' AS "tenancyId",
        "groupKey"->'customerId' AS "customerId",
        ("state" #>> '{}')::numeric AS "total"
      `),
    }));
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "r1", expr(`'{"tenancyId":"t1","customerId":"u1","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r2", expr(`'{"tenancyId":"t1","customerId":"u1","value":5}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r3", expr(`'{"tenancyId":"t1","customerId":"u2","value":7}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r4", expr(`'{"tenancyId":"t2","customerId":"u1","value":20}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r5", expr(`'{"tenancyId":"t2","customerId":"u1","value":3}'::jsonb`)));

    const rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(`${a.tenancyId}:${a.customerId}`, `${b.tenancyId}:${b.customerId}`));

    expect(rows).toEqual([
      { tenancyId: "t1", customerId: "u1", total: 15 },
      { tenancyId: "t1", customerId: "u2", total: 7 },
      { tenancyId: "t2", customerId: "u1", total: 23 },
    ]);

    // Move r3 from (t1,u2) to (t1,u1) and r5 from (t2,u1) to (t1,u2)
    await runStatements(source.setRow(executionContext, "r3", expr(`'{"tenancyId":"t1","customerId":"u1","value":7}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "r5", expr(`'{"tenancyId":"t1","customerId":"u2","value":3}'::jsonb`)));

    const rowsAfterMoves = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(`${a.tenancyId}:${a.customerId}`, `${b.tenancyId}:${b.customerId}`));

    expect(rowsAfterMoves).toEqual([
      { tenancyId: "t1", customerId: "u1", total: 22 },
      { tenancyId: "t1", customerId: "u2", total: 3 },
      { tenancyId: "t2", customerId: "u1", total: 20 },
    ]);
  });

  test("reduceTable delete + re-init backfills from current source state", async () => {
    const { source, grouped, reduced } = createSumReduceSetup();
    await runStatements(source.init(executionContext));
    await runStatements(grouped.init(executionContext));
    await runStatements(reduced.init(executionContext));

    await runStatements(source.setRow(executionContext, "u1", expr(`'{"team":"alpha","value":10}'::jsonb`)));
    await runStatements(source.setRow(executionContext, "u2", expr(`'{"team":"beta","value":7}'::jsonb`)));

    let rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));
    expect(rows).toEqual([
      { team: "alpha", total: 10 },
      { team: "beta", total: 7 },
    ]);

    await runStatements(reduced.delete(executionContext));

    await runStatements(source.setRow(executionContext, "u3", expr(`'{"team":"alpha","value":20}'::jsonb`)));
    await runStatements(source.deleteRow(executionContext, "u2"));

    expect(await readBoolean(reduced.isInitialized(executionContext))).toBe(false);

    await runStatements(reduced.init(executionContext));

    rows = (await readRows(reduced.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true })))
      .map((r: any) => r.rowdata)
      .sort((a: any, b: any) => stringCompare(a.team, b.team));
    expect(rows).toEqual([
      { team: "alpha", total: 30 },
    ]);
  });

  test("toQueryableSqlQuery returns executable SQL", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init(executionContext));
    await runStatements(table.setRow(executionContext, "alpha", expr(`'{"value":1}'::jsonb`)));

    const query = table.listRowsInGroup(executionContext, {
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    });
    const rows = await sql.unsafe(toQueryableSqlQuery(query));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata).toEqual({ value: 1 });
  });
});
