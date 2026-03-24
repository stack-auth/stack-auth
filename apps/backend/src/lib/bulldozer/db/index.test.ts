import { stringCompare, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

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
type SqlQuery = { type: "query", sql: string };

function expr<T>(sql: string): SqlExpression<T> {
  return { type: "expression", sql };
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

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`DROP TABLE IF EXISTS "BulldozerTriggerAudit"`;
    await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
    await sql`
      CREATE TABLE "BulldozerStorageEngine" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "keyPath" TEXT[] NOT NULL,
        "keyPathParent" TEXT[] GENERATED ALWAYS AS (
          CASE
            WHEN cardinality("keyPath") > 1 THEN "keyPath"[1:cardinality("keyPath") - 1]
            ELSE "keyPath"
          END
        ) STORED,
        "value" JSONB NOT NULL,
        CONSTRAINT "BulldozerStorageEngine_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BulldozerStorageEngine_keyPath_key" UNIQUE ("keyPath"),
        CONSTRAINT "BulldozerStorageEngine_keyPath_non_empty_check" CHECK (cardinality("keyPath") >= 1),
        CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey"
          FOREIGN KEY ("keyPathParent")
          REFERENCES "BulldozerStorageEngine"("keyPath")
          ON DELETE CASCADE
      )
    `;
    await sql`CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent")`;
    await sql`
      CREATE TABLE "BulldozerTriggerAudit" (
        "id" SERIAL PRIMARY KEY,
        "event" TEXT NOT NULL,
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
      SELECT array_to_string("keyPath", ' -> ') AS "keyPath", "value"
      FROM "BulldozerStorageEngine"
      ORDER BY "keyPath"
    `);
    const snapshotRows = [...rows].map((row) => ({ keyPath: row.keyPath, value: row.value }));

    expect(snapshotRows).toMatchInlineSnapshot(`
      [
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
        ARRAY['table', 'external:users', 'storage', 'rows', 'x']::text[],
        ARRAY['table', 'external:users', 'storage']::text[],
        '{"rowData":{"value":1}}'::jsonb
      )
    `).rejects.toThrow('cannot insert a non-DEFAULT value into column "keyPathParent"');
  });

  test("keyPathParent foreign key rejects missing parent rows", async () => {
    await expect(sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES (
        ARRAY['missing-parent', 'child']::text[],
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
