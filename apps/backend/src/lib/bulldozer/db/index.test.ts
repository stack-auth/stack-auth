import { stringCompare, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { declareGroupByTable, declareMapTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

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

function expr<T>(sql: string): SqlExpression<T> {
  return { type: "expression", sql };
}
function mapper(sql: string): SqlMapper {
  return { type: "mapper", sql };
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

  test("groupBy listGroups returns all groups when the range is inclusive", async () => {
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
    expect(inclusive.map((row) => row.groupkey).sort(stringCompare)).toEqual(["alpha", "beta", "gamma"]);

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
      { rowIdentifier: "u1", rowData: { team: "alpha", mappedValue: 101 } },
      { rowIdentifier: "u3", rowData: { team: "alpha", mappedValue: 103 } },
    ]);

    const allRows = await readRows(mappedTable.listRowsInGroup({
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
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", mappedValue: 101 },
      },
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", mappedValue: 101 },
        newRowData: { team: "alpha", mappedValue: 102 },
      },
      {
        event: "map_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", mappedValue: 102 },
        newRowData: null,
      },
      {
        event: "map_change",
        groupKey: "beta",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "beta", mappedValue: 103 },
      },
      {
        event: "map_change",
        groupKey: "beta",
        rowIdentifier: "u1",
        oldRowData: { team: "beta", mappedValue: 103 },
        newRowData: null,
      },
    ]);
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
        rowIdentifier: "u1",
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
      { groupKey: "alpha", rowIdentifier: "rows", rowData: { team: "alpha", mappedValue: 102 } },
      { groupKey: "rows", rowIdentifier: "u1", rowData: { team: "rows", mappedValue: 101 } },
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
      { rowIdentifier: "u1", rowData: { team: "alpha", valueScaled: 30, bucket: "high" } },
      { rowIdentifier: "u2", rowData: { team: "alpha", valueScaled: 28, bucket: "low" } },
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
      { rowIdentifier: "u2", rowData: { team: "alpha", valueScaled: 28, bucket: "low" } },
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
      { rowIdentifier: specialIdentifier, rowData: { team: null, valueScaled: 26, bucket: "low" } },
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
      { groupKey: "alpha", rowIdentifier: "u1", rowData: { team: "alpha", valueScaled: 22, bucket: "low" } },
      { groupKey: "alpha", rowIdentifier: "u3", rowData: { team: "alpha", valueScaled: 26, bucket: "low" } },
      { groupKey: "beta", rowIdentifier: "u2", rowData: { team: "beta", valueScaled: 24, bucket: "low" } },
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
      { rowIdentifier: "u2", rowData: { team: "beta", valueScaled: 60, bucket: "high" } },
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
    expect(lowRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["u1", "u3"]);

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
    expect(highRows.map((row) => row.rowidentifier).sort(stringCompare)).toEqual(["u1", "u2"]);
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
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
      },
      {
        event: "map_level_2_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
        newRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
      },
      {
        event: "map_level_2_change",
        groupKey: "alpha",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
        newRowData: null,
      },
    ]);
    expect(await readGroupTriggerAuditRows()).toEqual([
      {
        event: "bucket_group_change",
        groupKey: "low",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
      },
      {
        event: "bucket_group_change",
        groupKey: "low",
        rowIdentifier: "u1",
        oldRowData: { team: "alpha", valueScaled: 22, bucket: "low" },
        newRowData: null,
      },
      {
        event: "bucket_group_change",
        groupKey: "high",
        rowIdentifier: "u1",
        oldRowData: null,
        newRowData: { team: "alpha", valueScaled: 80, bucket: "high" },
      },
      {
        event: "bucket_group_change",
        groupKey: "high",
        rowIdentifier: "u1",
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
      { groupKey: "high", rowIdentifier: "u1", rowData: { team: "alpha", valueScaled: 30, bucket: "high" } },
      { groupKey: "low", rowIdentifier: "u3", rowData: { team: "gamma", valueScaled: 24, bucket: "low" } },
      { groupKey: "low", rowIdentifier: "u4", rowData: { team: "delta", valueScaled: 20, bucket: "low" } },
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
