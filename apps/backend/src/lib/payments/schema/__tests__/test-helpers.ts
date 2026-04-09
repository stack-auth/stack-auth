/**
 * Shared test helpers for payments schema tests.
 *
 * Uses the existing dev database (which already has BulldozerStorageEngine).
 * Our "payments-*" table IDs don't conflict with anything else.
 */

import postgres from "postgres";
import { toExecutableSqlTransaction, toQueryableSqlQuery } from "@/lib/bulldozer/db/index";

type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };

export function getConnectionString(): string {
  const env = Reflect.get(import.meta, "env");
  const connectionString = Reflect.get(env, "STACK_DATABASE_CONNECTION_STRING");
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("Missing STACK_DATABASE_CONNECTION_STRING");
  }
  return connectionString;
}

export function createSqlConnection() {
  return postgres(getConnectionString(), { onnotice: () => undefined, max: 1 });
}

export function makeRunStatements(sql: ReturnType<typeof postgres>) {
  return async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(statements));
  };
}

export function makeReadRows(sql: ReturnType<typeof postgres>) {
  return async function readRows(query: SqlQuery) {
    return await sql.unsafe(toQueryableSqlQuery(query));
  };
}

export function jsonbExpr(obj: unknown) {
  return { type: "expression" as const, sql: `'${JSON.stringify(obj).replaceAll("'", "''")}'::jsonb` };
}

/**
 * Runs table.delete() for each table, swallowing individual errors so that
 * all tables get a cleanup attempt even if one fails.
 */
export async function cleanupTables(
  runStatements: (statements: SqlStatement[]) => Promise<void>,
  tables: Array<{ delete(): SqlStatement[] }>,
) {
  for (const table of tables) {
    try {
      await runStatements(table.delete());
    } catch (e) {
      console.warn("cleanup: failed to delete table, ignoring:", e);
    }
  }
}
