/**
 * Shared test helpers for payments schema tests.
 *
 * Creates an isolated test database per test file (matching the bulldozer
 * core test pattern). Each file gets a fresh BulldozerStorageEngine table
 * with no leftover state.
 */

import postgres from "postgres";
import { toExecutableSqlTransaction, toQueryableSqlQuery } from "@/lib/bulldozer/db/index";

type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };

function getConnectionString(): string {
  const env = Reflect.get(import.meta, "env");
  const connectionString = Reflect.get(env, "STACK_DATABASE_CONNECTION_STRING");
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("Missing STACK_DATABASE_CONNECTION_STRING");
  }
  return connectionString;
}

/**
 * Creates an isolated test database. Call `setup()` in beforeAll and
 * `teardown()` in afterAll. Access `runStatements` / `readRows` after setup.
 *
 * Follows the same pattern as apps/backend/src/lib/bulldozer/db/index.test.ts.
 */
export function createTestDb() {
  const connectionString = getConnectionString();
  const base = connectionString.replace(/\/[^/]*(\?.*)?$/, "");
  const queryString = connectionString.split("?")[1] ?? "";
  const dbName = `stack_payments_test_${Math.random().toString(16).slice(2, 12)}`;
  const dbUrl = queryString.length === 0 ? `${base}/${dbName}` : `${base}/${dbName}?${queryString}`;

  const adminSql = postgres(base, { onnotice: () => undefined });
  let _sql: ReturnType<typeof postgres> | null = null;

  const getSql = (): ReturnType<typeof postgres> => {
    if (_sql == null) throw new Error("Test database not initialized — call setup() in beforeAll first");
    return _sql;
  };

  return {
    get sql() { return getSql(); },

    runStatements: async (statements: SqlStatement[]) => {
      await getSql().unsafe(toExecutableSqlTransaction(statements));
    },

    readRows: async (query: SqlQuery) => {
      return await getSql().unsafe(toQueryableSqlQuery(query));
    },

    setup: async () => {
      await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
      _sql = postgres(dbUrl, { onnotice: () => undefined, max: 1 });
      await _sql.unsafe("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await _sql.unsafe(`
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
      `);
      await _sql.unsafe(
        `CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent")`
      );
      await _sql.unsafe(`
        INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
        VALUES
          (ARRAY[]::jsonb[], 'null'::jsonb),
          (ARRAY[to_jsonb('table'::text)]::jsonb[], 'null'::jsonb)
      `);
      await _sql.unsafe(`
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
      `);
      await _sql.unsafe(`
        CREATE INDEX "BulldozerTimeFoldQueue_scheduledAt_idx"
        ON "BulldozerTimeFoldQueue"("scheduledAt")
      `);
      await _sql.unsafe(`
        CREATE TABLE "BulldozerTimeFoldMetadata" (
          "key" TEXT PRIMARY KEY,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "lastProcessedAt" TIMESTAMPTZ NOT NULL
        )
      `);
      await _sql.unsafe(`
        INSERT INTO "BulldozerTimeFoldMetadata" ("key", "lastProcessedAt")
        VALUES ('singleton', '2099-01-01T00:00:00Z'::timestamptz)
      `);
    },

    teardown: async () => {
      if (_sql != null) {
        await _sql.end();
        _sql = null;
      }
      await adminSql.unsafe(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${dbName}'
          AND pid <> pg_backend_pid()
      `);
      await adminSql.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminSql.end();
    },
  };
}

export function jsonbExpr(obj: unknown) {
  return { type: "expression" as const, sql: `'${JSON.stringify(obj).replaceAll("'", "''")}'::jsonb` };
}
