import { stringCompare, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "vitest";
import { declareConcatTable, declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLeftJoinTable, declareLFoldTable, declareLimitTable, declareMapTable, declareSortTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

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
  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });

  async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(statements));
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

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    const groupedTable = declareGroupByTable({
      tableId: "users-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    return { fromTable, groupedTable };
  }
  function createMappedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const mappedTable = declareMapTable({
      tableId: "users-by-team-mapped",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 100) AS "mappedValue"
      `),
    });
    return { fromTable, groupedTable, mappedTable };
  }
  function createFlatMappedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const flatMappedTable = declareFlatMapTable({
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
    });
    return { fromTable, groupedTable, flatMappedTable };
  }
  function createFilteredTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const filteredTable = declareFilterTable({
      tableId: "users-by-team-filtered",
      fromTable: groupedTable,
      filter: predicate(`(("rowData"->>'value')::int) >= 2`),
    });
    return { fromTable, groupedTable, filteredTable };
  }
  function createLimitedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const limitedTable = declareLimitTable({
      tableId: "users-by-team-limited",
      fromTable: groupedTable,
      limit: expr(`2`),
    });
    return { fromTable, groupedTable, limitedTable };
  }
  function createConcatenatedTable() {
    const fromTableA = declareStoredTable<{ value: number, team: string }>({ tableId: "users-a" });
    const fromTableB = declareStoredTable<{ value: number, team: string }>({ tableId: "users-b" });
    const groupedTableA = declareGroupByTable({
      tableId: "users-a-by-team",
      fromTable: fromTableA,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const groupedTableB = declareGroupByTable({
      tableId: "users-b-by-team",
      fromTable: fromTableB,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const concatenatedTable = declareConcatTable({
      tableId: "users-by-team-concat",
      tables: [groupedTableA, groupedTableB],
    });
    return { fromTableA, fromTableB, groupedTableA, groupedTableB, concatenatedTable };
  }
  function createSortedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const sortedTable = declareSortTable({
      tableId: "users-by-team-sorted",
      fromTable: groupedTable,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
    });
    return { fromTable, groupedTable, sortedTable };
  }
  function createDescendingSortedTable() {
    const { fromTable, groupedTable } = createGroupedTable();
    const sortedTable = declareSortTable({
      tableId: "users-by-team-sorted-desc",
      fromTable: groupedTable,
      getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
      compareSortKeys: (a, b) => expr(`(((${b.sql}) #>> '{}')::int) - (((${a.sql}) #>> '{}')::int)`),
    });
    return { fromTable, groupedTable, sortedTable };
  }
  function createDescendingLimitedTable() {
    const { fromTable, groupedTable, sortedTable } = createDescendingSortedTable();
    const limitedTable = declareLimitTable({
      tableId: "users-by-team-limit-desc",
      fromTable: sortedTable,
      limit: expr(`2`),
    });
    return { fromTable, groupedTable, sortedTable, limitedTable };
  }
  function createDescendingLFoldTable() {
    const { fromTable, groupedTable, sortedTable } = createDescendingSortedTable();
    const lFoldTable = declareLFoldTable({
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
    });
    return { fromTable, groupedTable, sortedTable, lFoldTable };
  }
  function createLFoldTable() {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    const lFoldTable = declareLFoldTable({
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
    });
    return { fromTable, groupedTable, sortedTable, lFoldTable };
  }
  function createLeftJoinedTable() {
    const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: "left-join-users" });
    const joinTable = declareStoredTable<{ team: string | null, threshold: number, label: string }>({ tableId: "left-join-rules" });
    const groupedFromTable = declareGroupByTable({
      tableId: "left-join-users-by-team",
      fromTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const groupedJoinTable = declareGroupByTable({
      tableId: "left-join-rules-by-team",
      fromTable: joinTable,
      groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
    });
    const leftJoinedTable = declareLeftJoinTable({
      tableId: "left-join-users-rules",
      leftTable: groupedFromTable,
      rightTable: groupedJoinTable,
      on: predicate(`(("rightRowData"->>'threshold')::int) <= (("leftRowData"->>'value')::int)`),
    });
    return { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable };
  }
  function createFlatMapMapGroupPipeline() {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    const mappedAfterFlatMap = declareMapTable({
      tableId: "users-by-team-flat-map-then-map",
      fromTable: flatMappedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        ("rowData"->'kind') AS "kind",
        (("rowData"->>'mappedValue')::int + 1) AS "mappedValuePlusOne"
      `),
    });
    const groupedByKind = declareGroupByTable({
      tableId: "users-by-kind",
      fromTable: mappedAfterFlatMap,
      groupBy: mapper(`"rowData"->'kind' AS "groupKey"`),
    });
    return { fromTable, groupedTable, flatMappedTable, mappedAfterFlatMap, groupedByKind };
  }
  function createStackedMappedTables() {
    const { fromTable, groupedTable } = createGroupedTable();
    const mappedTableLevel1 = declareMapTable({
      tableId: "users-by-team-map-level-1",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 10) AS "valuePlusTen"
      `),
    });
    const mappedTableLevel2 = declareMapTable({
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
    });
    return { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 };
  }
  function createGroupMapGroupPipeline() {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    const groupedByBucketTable = declareGroupByTable({
      tableId: "users-by-bucket",
      fromTable: mappedTableLevel2,
      groupBy: mapper(`"rowData"->'bucket' AS "groupKey"`),
    });
    return { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2, groupedByBucketTable };
  }
  function registerGroupAuditTrigger(
    table: ReturnType<typeof createGroupedTable>["groupedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
    return table.registerRowChangeTrigger((changesTable) => [
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
  function registerLeftJoinAuditTrigger(
    table: ReturnType<typeof createLeftJoinedTable>["leftJoinedTable"],
    event: string,
  ) {
    return table.registerRowChangeTrigger((changesTable) => [
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

  test("init/isInitialized/delete lifecycle", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    expect(await readBoolean(table.isInitialized())).toBe(false);
    await runStatements(table.init());
    expect(await readBoolean(table.isInitialized())).toBe(true);
    await runStatements(table.delete());
    expect(await readBoolean(table.isInitialized())).toBe(false);
  });

  test("trigger emits insert change row", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    registerAuditTrigger(table, "insert");

    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));

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

    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.setRow("alpha", expr(`'{"value":2}'::jsonb`)));

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

    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.deleteRow("missing"));
    await runStatements(table.deleteRow("alpha"));

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

    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(table.setRow("beta", expr(`'{"value":2}'::jsonb`)));

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

    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));

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

    await runStatements(table.init());
    await runStatements(table.setRow(weirdIdentifier, expr(`'{"value":1,"label":"first"}'::jsonb`)));
    await runStatements(table.setRow(weirdIdentifier, expr(`'{"value":2,"label":"second"}'::jsonb`)));
    await runStatements(table.setRow("plain-row", expr(`'{"value":3,"label":"third"}'::jsonb`)));

    const rows = await readRows(table.listRowsInGroup({
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

  test("table contents snapshot after init + upserts", async () => {
    const table = declareStoredTable<{ value: number, label: string }>({ tableId: "users" });
    const weirdIdentifier = "row.with/slash and spaces";

    await runStatements(table.init());
    await runStatements(table.setRow(weirdIdentifier, expr(`'{"value":1,"label":"first"}'::jsonb`)));
    await runStatements(table.setRow(weirdIdentifier, expr(`'{"value":2,"label":"second"}'::jsonb`)));
    await runStatements(table.setRow("plain-row", expr(`'{"value":3,"label":"third"}'::jsonb`)));

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

    await runStatements(table.init());
    await runStatements(table.setRow("a", expr(`'{"value":1}'::jsonb`)));
    await runStatements(table.setRow("b", expr(`'{"value":2}'::jsonb`)));
    await runStatements(table.deleteRow("missing"));
    await runStatements(table.deleteRow("a"));

    const rows = await readRows(table.listRowsInGroup({
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowdata).toEqual({ value: 2 });
    expect(await readBoolean(table.isInitialized())).toBe(true);
  });

  test("exclusive start/end excludes the single null group and rowSortKey", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init());
    await runStatements(table.setRow("row", expr(`'{"value":1}'::jsonb`)));

    const groups = await readRows(table.listGroups({
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(groups).toHaveLength(0);

    const rows = await readRows(table.listRowsInGroup({
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

    await runStatements(left.init());
    await runStatements(right.init());
    await runStatements(left.setRow("shared", expr(`'{"value":1}'::jsonb`)));
    await runStatements(right.setRow("shared", expr(`'{"value":2}'::jsonb`)));
    await runStatements(left.delete());

    const rightRows = await readRows(right.listRowsInGroup({
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));

    expect(await readBoolean(left.isInitialized())).toBe(false);
    expect(await readBoolean(right.isInitialized())).toBe(true);
    expect(rightRows).toHaveLength(1);
    expect(rightRows[0].rowdata).toEqual({ value: 2 });
  });

  test("rowIdentifier from listRowsInGroup can be passed to deleteRow", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init());
    await runStatements(table.setRow("plain-row", expr(`'{"value":1}'::jsonb`)));

    const listedRows = await readRows(table.listRowsInGroup({
      groupKey: expr("'null'::jsonb"),
      start: expr("'null'::jsonb"),
      end: expr("'null'::jsonb"),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(listedRows).toHaveLength(1);

    await runStatements(table.deleteRow(listedRows[0].rowidentifier));

    const remainingRows = await readRows(table.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));

    await runStatements(groupedTable.init());

    const groups = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(groupedTable.listRowsInGroup({
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

    const allRows = await readRows(groupedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerGroupAuditTrigger(groupedTable, "group_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    const handle = registerGroupAuditTrigger(groupedTable, "group_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

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
    await runStatements(fromTable.init());
    registerGroupAuditTrigger(groupedTable, "group_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(groupedTable.isInitialized())).toBe(false);
    expect(await readGroupTriggerAuditRows()).toEqual([]);
    const groups = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("groupBy delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(groupedTable.delete());
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(groupedTable.isInitialized())).toBe(false);
    const groupsBeforeReinit = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(groupedTable.init());
    const groupsAfterReinit = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("groupBy listGroups applies group-key ranges", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"gamma","value":3}'::jsonb`)));
    await runStatements(groupedTable.init());

    const inclusive = await readRows(groupedTable.listGroups({
      start: expr(`to_jsonb('beta'::text)`),
      end: expr(`to_jsonb('gamma'::text)`),
      startInclusive: true,
      endInclusive: true,
    }));
    expect(inclusive.map((row) => row.groupkey).sort(stringCompare)).toEqual(["beta", "gamma"]);

    const exclusive = await readRows(groupedTable.listGroups({
      start: expr(`to_jsonb('beta'::text)`),
      end: expr(`to_jsonb('gamma'::text)`),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(exclusive).toEqual([]);
  });

  test("groupBy removes empty groups after moves and deletes", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    const groupsAfterInsert = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterInsert.map((row) => row.groupkey)).toEqual(["alpha"]);

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    const groupsAfterMove = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["beta"]);

    await runStatements(fromTable.deleteRow("u1"));
    const groupsAfterDelete = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterDelete).toEqual([]);
  });

  test("groupBy deletes stale group paths from storage", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const missingGroupRows = await readRows(groupedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('missing'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(missingGroupRows).toEqual([]);

    const exclusiveRows = await readRows(groupedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: expr(`'null'::jsonb`),
      end: expr(`'null'::jsonb`),
      startInclusive: false,
      endInclusive: false,
    }));
    expect(exclusiveRows).toEqual([]);

    const inclusiveRows = await readRows(groupedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(groupedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerGroupAuditTrigger(groupedTable, "group_trigger_a");
    registerGroupAuditTrigger(groupedTable, "group_trigger_b");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    const rows = await readGroupTriggerAuditRows();
    expect(rows.map((row) => row.event).sort(stringCompare)).toEqual(["group_trigger_a", "group_trigger_b"]);
  });

  test("groupBy supports null group keys and transitions away cleanly", async () => {
    const { fromTable, groupedTable } = createGroupedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":null,"value":1}'::jsonb`)));
    const nullGroupRows = await readRows(groupedTable.listRowsInGroup({
      groupKey: expr(`'null'::jsonb`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nullGroupRows.map((row) => row.rowidentifier)).toEqual(["u1"]);

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    const groups = await readRows(groupedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  test("mapTable init backfills groups and mapped rows", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());

    const groups = await readRows(mappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(mappedTable.listRowsInGroup({
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

    const allRows = await readRows(mappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow("user:1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("user:1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readMapTriggerAuditRows()).toEqual([
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "user:1:1",
        oldRowData: null,
        newRowData: { team: "alpha", mappedValue: 101 },
      },
    ]);

    const alphaRows = await readRows(mappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    const handle = registerMapAuditTrigger(mappedTable, "map_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    handle.deregister();
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerMapAuditTrigger(mappedTable, "map_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(mappedTable.isInitialized())).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    const groups = await readRows(mappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("mapTable delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(mappedTable.delete());
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(mappedTable.isInitialized())).toBe(false);
    const groupsBeforeReinit = await readRows(mappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(mappedTable.init());
    const groupsAfterReinit = await readRows(mappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("mapTable listRowsInGroup handles missing groups and exclusive bounds", async () => {
    const { fromTable, groupedTable, mappedTable } = createMappedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    const missingGroupRows = await readRows(mappedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('missing'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(missingGroupRows).toEqual([]);

    const exclusiveRows = await readRows(mappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(mappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    const equivalentFlatMapTable = declareFlatMapTable({
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
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTable.init());
    await runStatements(equivalentFlatMapTable.init());

    mappedTable.registerRowChangeTrigger((changesTable) => [
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
    equivalentFlatMapTable.registerRowChangeTrigger((changesTable) => [
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

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

    const mapGroups = await readRows(mappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const flatGroups = await readRows(equivalentFlatMapTable.listGroups({
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
    const mapRows = normalizeRows(await readRows(mappedTable.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })));
    const flatRows = normalizeRows(await readRows(equivalentFlatMapTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":-1}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());

    const groups = await readRows(flatMappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(flatMappedTable.listRowsInGroup({
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

    const allRows = await readRows(flatMappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());
    registerFlatMapAuditTrigger(flatMappedTable, "flat_map_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":-1}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerFlatMapAuditTrigger(flatMappedTable, "flat_map_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));

    expect(await readBoolean(flatMappedTable.isInitialized())).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    const groups = await readRows(flatMappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups).toEqual([]);
  });

  test("flatMapTable delete cleans up and re-init backfills from source", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(flatMappedTable.delete());
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    expect(await readBoolean(flatMappedTable.isInitialized())).toBe(false);
    const groupsBeforeReinit = await readRows(flatMappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsBeforeReinit).toEqual([]);

    await runStatements(flatMappedTable.init());
    const groupsAfterReinit = await readRows(flatMappedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterReinit.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);
  });

  test("flatMapTable listRowsInGroup (all groups) handles 'rows' collisions in group key and source row identifier", async () => {
    const { fromTable, groupedTable, flatMappedTable } = createFlatMappedTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"rows","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("rows", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const allRows = await readRows(flatMappedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":-1}'::jsonb`)));

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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"beta","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u4", expr(`'{"team":"beta","value":0}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(filteredTable.init());

    expect(await readBoolean(filteredTable.isInitialized())).toBe(true);

    const groups = await readRows(filteredTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const allRows = await readRows(filteredTable.listRowsInGroup({
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

    await runStatements(filteredTable.delete());
    expect(await readBoolean(filteredTable.isInitialized())).toBe(false);
    const groupsAfterDelete = await readRows(filteredTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterDelete).toEqual([]);
  });

  test("filterTable registerRowChangeTrigger emits inserts, updates, deletes, and moves", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(filteredTable.init());
    registerFilterAuditTrigger(filteredTable, "filter_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":5}'::jsonb`)));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerFilterAuditTrigger(filteredTable, "filter_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    expect(await readBoolean(filteredTable.isInitialized())).toBe(false);
    expect(await readMapTriggerAuditRows()).toEqual([]);
    expect(await readRows(filteredTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("filterTable listRowsInGroup (all groups) handles 'rows' collisions in group key and source row identifier", async () => {
    const { fromTable, groupedTable, filteredTable } = createFilteredTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(filteredTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"rows","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("rows", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const allRows = await readRows(filteredTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b1", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(limitedTable.init());

    const groups = await readRows(limitedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const allRows = await readRows(limitedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(limitedTable.init());

    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    let alphaRows = await readRows(limitedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["u2", "u3"]);

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    alphaRows = await readRows(limitedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => row.rowidentifier)).toEqual(["u1", "u2"]);

    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":22}'::jsonb`)));
    alphaRows = await readRows(limitedTable.listRowsInGroup({
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

    await runStatements(fromTable.deleteRow("u1"));
    alphaRows = await readRows(limitedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(limitedTable.init());
    registerLimitAuditTrigger(limitedTable, "limit_change");

    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("a4", expr(`'{"team":"alpha","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.deleteRow("a1"));
    await runStatements(fromTable.setRow("a5", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("a0", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    await runStatements(fromTable.deleteRow("a2"));
    await runStatements(fromTable.setRow("a0", expr(`'{"team":"beta","value":100}'::jsonb`)));

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

    const actualRows = (await readRows(limitedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerLimitAuditTrigger(limitedTable, "limit_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    expect(await readBoolean(limitedTable.isInitialized())).toBe(false);
    const groups = await readRows(limitedTable.listGroups({
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
    await runStatements(fromTableA.init());
    await runStatements(fromTableB.init());
    await runStatements(groupedTableA.init());
    await runStatements(groupedTableB.init());

    await runStatements(fromTableA.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTableA.setRow("a2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTableB.setRow("b1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTableB.setRow("b2", expr(`'{"team":"gamma","value":4}'::jsonb`)));

    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(false);
    expect(await readRows(concatenatedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
    await runStatements(concatenatedTable.init());
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);

    const groups = await readRows(concatenatedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta", "gamma"]);

    const alphaRows = await readRows(concatenatedTable.listRowsInGroup({
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

    const allRows = await readRows(concatenatedTable.listRowsInGroup({
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
    await runStatements(fromTableA.init());
    await runStatements(fromTableB.init());
    await runStatements(groupedTableA.init());
    await runStatements(groupedTableB.init());
    await runStatements(concatenatedTable.init());
    registerConcatAuditTrigger(concatenatedTable, "concat_change");

    await runStatements(fromTableA.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTableB.setRow("b1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTableB.setRow("b1", expr(`'{"team":"gamma","value":5}'::jsonb`)));
    await runStatements(fromTableA.deleteRow("a1"));

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

    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(false);

    const beforeInitGroups = await readRows(concatenatedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(beforeInitGroups).toEqual([]);

    await runStatements(fromTableA.init());
    await runStatements(groupedTableA.init());
    await runStatements(fromTableA.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(false);

    const oneSideOnlyRows = await readRows(concatenatedTable.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(oneSideOnlyRows).toEqual([]);

    await runStatements(concatenatedTable.init());
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);
    const rowsAfterConcatInit = await readRows(concatenatedTable.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterConcatInit.map((row) => row.rowidentifier)).toEqual(["0:a1"]);

    await runStatements(fromTableB.init());
    await runStatements(groupedTableB.init());
    await runStatements(fromTableB.setRow("b1", expr(`'{"team":"beta","value":2}'::jsonb`)));
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);

    await runStatements(concatenatedTable.delete());
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(false);

    const rowsAfterDelete = await readRows(concatenatedTable.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterDelete).toEqual([]);

    await runStatements(concatenatedTable.init());
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);

    await runStatements(groupedTableB.delete());
    expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);
    const rowsAfterInputDelete = await readRows(concatenatedTable.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(rowsAfterInputDelete.map((row) => row.rowidentifier)).toEqual(["0:a1"]);
  });

  test("sortTable init backfills rows in computed sort order and stores metadata", async () => {
    const { fromTable, groupedTable, sortedTable } = createSortedTable();
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b1", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());

    expect(await readBoolean(sortedTable.isInitialized())).toBe(true);
    const groups = await readRows(sortedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(sortedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    registerSortAuditTrigger(sortedTable, "sort_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":1}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u4", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const midRows = await readRows(sortedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    registerSortAuditTrigger(sortedTable, "sort_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    expect(await readBoolean(sortedTable.isInitialized())).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "sort_change")).toEqual([]);
    expect(await readRows(sortedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("lFoldTable init backfills flattened rows in deterministic sorted order", async () => {
    const { fromTable, groupedTable, sortedTable, lFoldTable } = createLFoldTable();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b1", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(sortedTable.init());
    await runStatements(lFoldTable.init());

    expect(await readBoolean(lFoldTable.isInitialized())).toBe(true);
    const groups = await readRows(lFoldTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(lFoldTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(lFoldTable.init());

    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":5}'::jsonb`)));

    const beforeTailUpdate = await readRows(lFoldTable.listRowsInGroup({
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

    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    const afterTailUpdate = await readRows(lFoldTable.listRowsInGroup({
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

    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":0}'::jsonb`)));
    const afterMiddleMove = await readRows(lFoldTable.listRowsInGroup({
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

    await runStatements(fromTable.deleteRow("a1"));
    const afterDelete = await readRows(lFoldTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(lFoldTable.init());
    registerLFoldAuditTrigger(lFoldTable, "lfold_change");

    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("b1", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    await runStatements(fromTable.deleteRow("a1"));

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

    const actualRows = (await readRows(lFoldTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(lFoldTable.init());

    await runStatements(fromTable.setRow("z", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    const alphaRows = await readRows(lFoldTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    registerLFoldAuditTrigger(lFoldTable, "lfold_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":2}'::jsonb`)));

    expect(await readBoolean(lFoldTable.isInitialized())).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "lfold_change")).toEqual([]);
    expect(await readRows(lFoldTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("leftJoinTable init backfills matches and unmatched left rows per group", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init());
    await runStatements(joinTable.init());
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":2,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow("r2", expr(`'{"team":"alpha","threshold":4,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow("r3", expr(`'{"team":"beta","threshold":3,"label":"vip"}'::jsonb`)));
    await runStatements(groupedFromTable.init());
    await runStatements(groupedJoinTable.init());
    await runStatements(leftJoinedTable.init());

    expect(await readBoolean(leftJoinedTable.isInitialized())).toBe(true);
    const groups = await readRows(leftJoinedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta"]);

    const alphaRows = await readRows(leftJoinedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata })).sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier))).toEqual([
      {
        rowIdentifier: `["u1", "r1"]`,
        rowData: {
          leftRowData: { team: "alpha", value: 5 },
          rightRowData: { team: "alpha", threshold: 2, label: "silver" },
        },
      },
      {
        rowIdentifier: `["u1", "r2"]`,
        rowData: {
          leftRowData: { team: "alpha", value: 5 },
          rightRowData: { team: "alpha", threshold: 4, label: "gold" },
        },
      },
      {
        rowIdentifier: `["u2", null]`,
        rowData: {
          leftRowData: { team: "alpha", value: 1 },
          rightRowData: null,
        },
      },
    ]);

    const betaRows = await readRows(leftJoinedTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('beta'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(betaRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      {
        rowIdentifier: `["u3", null]`,
        rowData: {
          leftRowData: { team: "beta", value: 2 },
          rightRowData: null,
        },
      },
    ]);
  });

  test("leftJoinTable recomputes touched groups when either input table changes", async () => {
    const { fromTable, joinTable, groupedFromTable, groupedJoinTable, leftJoinedTable } = createLeftJoinedTable();
    await runStatements(fromTable.init());
    await runStatements(joinTable.init());
    await runStatements(groupedFromTable.init());
    await runStatements(groupedJoinTable.init());
    await runStatements(leftJoinedTable.init());

    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":2,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow("r2", expr(`'{"team":"alpha","threshold":4,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow("rb1", expr(`'{"team":"beta","threshold":3,"label":"beta-rule"}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":4}'::jsonb`)));
    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":6,"label":"silver"}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":5}'::jsonb`)));
    await runStatements(joinTable.deleteRow("rb1"));
    await runStatements(fromTable.deleteRow("u3"));
    await runStatements(fromTable.deleteRow("u2"));

    const groups = await readRows(leftJoinedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey)).toEqual(["beta"]);

    const betaRows = await readRows(leftJoinedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(joinTable.init());
    await runStatements(groupedFromTable.init());
    await runStatements(groupedJoinTable.init());
    await runStatements(leftJoinedTable.init());

    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(joinTable.setRow("r2", expr(`'{"team":"alpha","threshold":1,"label":"rule-2"}'::jsonb`)));
    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":1,"label":"rule-1"}'::jsonb`)));

    const alphaRows = await readRows(leftJoinedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());

    const alphaRows = await readRows(sortedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(limitedTable.init());

    const alphaRows = await readRows(limitedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(fromTable.setRow("a1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("a2", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("a3", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(groupedTable.init());
    await runStatements(sortedTable.init());
    await runStatements(lFoldTable.init());

    const alphaRows = await readRows(lFoldTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(joinTable.init());
    await runStatements(groupedFromTable.init());
    await runStatements(groupedJoinTable.init());
    await runStatements(leftJoinedTable.init());
    registerLeftJoinAuditTrigger(leftJoinedTable, "left_join_change");

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"beta","value":7}'::jsonb`)));
    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":3,"label":"silver"}'::jsonb`)));
    await runStatements(joinTable.setRow("r2", expr(`'{"team":"alpha","threshold":5,"label":"gold"}'::jsonb`)));
    await runStatements(joinTable.setRow("r3", expr(`'{"team":"beta","threshold":6,"label":"beta"}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"beta","value":8}'::jsonb`)));
    await runStatements(joinTable.deleteRow("r2"));
    await runStatements(fromTable.deleteRow("u3"));

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

    const actualRows = (await readRows(leftJoinedTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(joinTable.init());
    await runStatements(groupedFromTable.init());
    await runStatements(groupedJoinTable.init());
    registerLeftJoinAuditTrigger(leftJoinedTable, "left_join_change");
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(joinTable.setRow("r1", expr(`'{"team":"alpha","threshold":2,"label":"silver"}'::jsonb`)));

    expect(await readBoolean(leftJoinedTable.isInitialized())).toBe(false);
    expect((await readMapTriggerAuditRows()).filter((row) => row.event === "left_join_change")).toEqual([]);
    expect(await readRows(leftJoinedTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }))).toEqual([]);
  });

  test("flatMap -> map -> groupBy composition stays consistent across updates", async () => {
    const { fromTable, groupedTable, flatMappedTable, mappedAfterFlatMap, groupedByKind } = createFlatMapMapGroupPipeline();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(flatMappedTable.init());
    await runStatements(mappedAfterFlatMap.init());
    await runStatements(groupedByKind.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":-1}'::jsonb`)));

    const groups = await readRows(groupedByKind.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["base", "double"]);

    const baseRows = await readRows(groupedByKind.listRowsInGroup({
      groupKey: expr(`to_jsonb('base'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(baseRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: "u2:1:1", rowData: { team: "beta", kind: "base", mappedValuePlusOne: 103 } },
    ]);

    const doubleRows = await readRows(groupedByKind.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":7}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"alpha","value":4}'::jsonb`)));

    const groupsAfterMove = await readRows(mappedTableLevel2.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["alpha"]);

    const alphaRows = await readRows(mappedTableLevel2.listRowsInGroup({
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

    await runStatements(fromTable.deleteRow("u1"));
    const alphaRowsAfterDelete = await readRows(mappedTableLevel2.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());

    const specialIdentifier = "user/one:two space";
    await runStatements(fromTable.setRow(specialIdentifier, expr(`'{"team":null,"value":3}'::jsonb`)));

    const nullGroupRows = await readRows(mappedTableLevel2.listRowsInGroup({
      groupKey: expr(`'null'::jsonb`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(nullGroupRows.map((row) => ({ rowIdentifier: row.rowidentifier, rowData: row.rowdata }))).toEqual([
      { rowIdentifier: `${specialIdentifier}:1:1`, rowData: { team: null, valueScaled: 26, bucket: "low" } },
    ]);

    await runStatements(fromTable.setRow(specialIdentifier, expr(`'{"team":"alpha","value":3}'::jsonb`)));
    const groupsAfterMove = await readRows(mappedTableLevel2.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsAfterMove.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  test("stacked map tables backfill correctly with staggered initialization order", async () => {
    const { fromTable, groupedTable, mappedTableLevel1, mappedTableLevel2 } = createStackedMappedTables();
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":2}'::jsonb`)));

    await runStatements(mappedTableLevel1.init());
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"alpha","value":3}'::jsonb`)));

    await runStatements(mappedTableLevel2.init());
    const allRowsAfterInit = await readRows(mappedTableLevel2.listRowsInGroup({
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

    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    const betaRows = await readRows(mappedTableLevel2.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());
    await runStatements(groupedByBucketTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"gamma","value":2}'::jsonb`)));

    const initialGroups = await readRows(groupedByBucketTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(initialGroups.map((row) => row.groupkey).sort(stringCompare)).toEqual(["high", "low"]);

    const lowRows = await readRows(groupedByBucketTable.listRowsInGroup({
      groupKey: expr(`to_jsonb('low'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(lowRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["u1:1:1", "u3:1:1"]);

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":30}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u3"));

    const finalGroups = await readRows(groupedByBucketTable.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(finalGroups.map((row) => row.groupkey)).toEqual(["high"]);

    const highRows = await readRows(groupedByBucketTable.listRowsInGroup({
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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());
    await runStatements(groupedByBucketTable.init());

    mappedTableLevel2.registerRowChangeTrigger((changesTable) => [
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
    groupedByBucketTable.registerRowChangeTrigger((changesTable) => [
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

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":30}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u1"));

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
    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());
    await runStatements(groupedByBucketTable.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":1}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":20}'::jsonb`)));
    await runStatements(fromTable.setRow("u3", expr(`'{"team":"gamma","value":2}'::jsonb`)));

    await runStatements(groupedByBucketTable.delete());
    await runStatements(mappedTableLevel2.delete());
    await runStatements(mappedTableLevel1.delete());

    expect(await readBoolean(mappedTableLevel1.isInitialized())).toBe(false);
    expect(await readBoolean(mappedTableLevel2.isInitialized())).toBe(false);
    expect(await readBoolean(groupedByBucketTable.isInitialized())).toBe(false);

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":5}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u2"));
    await runStatements(fromTable.setRow("u4", expr(`'{"team":"delta","value":0}'::jsonb`)));

    await runStatements(mappedTableLevel1.init());
    await runStatements(mappedTableLevel2.init());
    await runStatements(groupedByBucketTable.init());

    const allBucketRows = await readRows(groupedByBucketTable.listRowsInGroup({
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
    const mapTableA = declareMapTable({
      tableId: "users-map-a",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        (("rowData"->>'value')::int + 100) AS "mappedValueA"
      `),
    });
    const mapTableB = declareMapTable({
      tableId: "users-map-b",
      fromTable: groupedTable,
      mapper: mapper(`
        ("rowData"->'team') AS "team",
        ((("rowData"->>'value')::int) * -1) AS "mappedValueB"
      `),
    });

    await runStatements(fromTable.init());
    await runStatements(groupedTable.init());
    await runStatements(mapTableA.init());
    await runStatements(mapTableB.init());

    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":3}'::jsonb`)));
    await runStatements(fromTable.setRow("u2", expr(`'{"team":"beta","value":4}'::jsonb`)));
    await runStatements(fromTable.setRow("u1", expr(`'{"team":"alpha","value":6}'::jsonb`)));
    await runStatements(fromTable.deleteRow("u2"));

    const alphaRowsA = await readRows(mapTableA.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRowsA.map((row) => row.rowdata)).toEqual([{ team: "alpha", mappedValueA: 106 }]);

    const alphaRowsB = await readRows(mapTableB.listRowsInGroup({
      groupKey: expr(`to_jsonb('alpha'::text)`),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(alphaRowsB.map((row) => row.rowdata)).toEqual([{ team: "alpha", mappedValueB: -6 }]);

    const groupsA = await readRows(mapTableA.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    const groupsB = await readRows(mapTableB.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(groupsA.map((row) => row.groupkey)).toEqual(["alpha"]);
    expect(groupsB.map((row) => row.groupkey)).toEqual(["alpha"]);
  });

  test("toExecutableSqlTransaction handles empty statements", async () => {
    await runStatements([]);
  });

  test("toQueryableSqlQuery returns executable SQL", async () => {
    const table = declareStoredTable<{ value: number }>({ tableId: "users" });
    await runStatements(table.init());
    await runStatements(table.setRow("alpha", expr(`'{"value":1}'::jsonb`)));

    const query = table.listRowsInGroup({
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
