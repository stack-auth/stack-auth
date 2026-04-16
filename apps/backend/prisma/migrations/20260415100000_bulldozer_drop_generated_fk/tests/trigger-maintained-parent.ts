import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const generatedColumnRows = await sql`
    SELECT attname
    FROM pg_attribute
    WHERE attrelid = 'public."BulldozerStorageEngine"'::regclass
      AND attname = 'keyPathParent'
      AND attgenerated = 's'
  `;
  expect(generatedColumnRows).toHaveLength(0);

  const fkConstraintRows = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public."BulldozerStorageEngine"'::regclass
      AND conname = 'BulldozerStorageEngine_keyPathParent_fkey'
  `;
  expect(fkConstraintRows).toHaveLength(0);

  const triggerRows = await sql`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public."BulldozerStorageEngine"'::regclass
      AND tgname = 'bulldozer_key_path_parent_trigger'
  `;
  expect(triggerRows).toHaveLength(1);

  const indexRows = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'BulldozerStorageEngine'
      AND indexname = 'BulldozerStorageEngine_keyPathParent_idx'
  `;
  expect(indexRows).toHaveLength(1);

  // Verify root row uses empty array (not NULL) for keyPathParent
  const rootRow = await sql`
    SELECT "keyPathParent"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ARRAY[]::jsonb[]
  `;
  expect(rootRow).toHaveLength(1);
  expect(rootRow[0].keyPathParent).toEqual([]);

  const tableRow = await sql`
    SELECT "keyPathParent"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ARRAY[to_jsonb('table'::text)]::jsonb[]
  `;
  expect(tableRow).toHaveLength(1);
  expect(tableRow[0].keyPathParent).toEqual([]);

  // Verify trigger computes keyPathParent on new inserts
  await sql`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      '00000000-0000-0000-0000-100000000001'::uuid,
      ARRAY[to_jsonb('table'::text), to_jsonb('test-trigger'::text)]::jsonb[],
      '"test"'::jsonb
    )
  `;

  const insertedRow = await sql`
    SELECT "keyPathParent"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ARRAY[to_jsonb('table'::text), to_jsonb('test-trigger'::text)]::jsonb[]
  `;
  expect(insertedRow).toHaveLength(1);
  expect(insertedRow[0].keyPathParent).toEqual(["table"]);

  // Column is NOT NULL — verify constraint exists
  const notNullRows = await sql`
    SELECT attnotnull
    FROM pg_attribute
    WHERE attrelid = 'public."BulldozerStorageEngine"'::regclass
      AND attname = 'keyPathParent'
  `;
  expect(notNullRows).toHaveLength(1);
  expect(notNullRows[0].attnotnull).toBe(true);

  // Cleanup test rows
  await sql`
    DELETE FROM "BulldozerStorageEngine"
    WHERE "id" = '00000000-0000-0000-0000-100000000001'::uuid
  `;
};
