import type { Sql } from "postgres";
import { expect } from "vitest";

const BULLDOZER_TABLES = [
  "BulldozerTimeFoldQueue",
  "BulldozerTimeFoldMetadata",
  "BulldozerTimeFoldDownstreamCascade",
  "BulldozerStorageEngine",
] as const;

const existingTables = async (sql: Sql): Promise<Set<string>> => {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${sql.array([...BULLDOZER_TABLES])})
  `;
  return new Set(rows.map((r) => r.table_name));
};

export const preMigration = async (sql: Sql) => {
  // Sanity: all four tables must exist before this migration runs.
  const present = await existingTables(sql);
  for (const table of BULLDOZER_TABLES) {
    expect(present.has(table), `${table} should exist before the migration`).toBe(true);
  }

  // Prove the drop works even when the tables hold data. The singleton
  // BulldozerTimeFoldMetadata row already exists; add a couple more rows so the
  // migration is dropping non-empty tables. BulldozerStorageEngine's
  // keyPathParent (generated) points at the empty-array root row seeded by the
  // create migration, satisfying the self-FK.
  await sql`
    INSERT INTO "BulldozerTimeFoldMetadata" ("key", "lastProcessedAt")
    VALUES ('test-drop-marker', now())
    ON CONFLICT ("key") DO NOTHING
  `;
  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (gen_random_uuid(), ARRAY[to_jsonb('test-drop-marker'::text)]::jsonb[], 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING
  `);
};

export const postMigration = async (sql: Sql) => {
  // All four tables are gone.
  const present = await existingTables(sql);
  expect(present.size).toBe(0);

  // Idempotency: re-running the drops must be a no-op (DROP TABLE IF EXISTS),
  // not an error.
  await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldQueue"`;
  await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldMetadata"`;
  await sql`DROP TABLE IF EXISTS "BulldozerTimeFoldDownstreamCascade"`;
  await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
  expect((await existingTables(sql)).size).toBe(0);
};
