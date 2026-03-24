import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  await sql`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      ('00000000-0000-0000-0000-000000000001'::uuid, ARRAY['root']::text[], '{"node":"root"}'::jsonb),
      ('00000000-0000-0000-0000-000000000002'::uuid, ARRAY['root', 'branch']::text[], '{"node":"branch"}'::jsonb),
      ('00000000-0000-0000-0000-000000000003'::uuid, ARRAY['root', 'branch', 'leaf']::text[], '{"node":"leaf"}'::jsonb),
      ('00000000-0000-0000-0000-000000000004'::uuid, ARRAY['root', 'other']::text[], '{"node":"other"}'::jsonb)
  `;

  const exactRows = await sql`
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ARRAY['root', 'branch', 'leaf']::text[]
  `;

  expect(exactRows).toHaveLength(1);
  expect(exactRows[0].value).toEqual({ node: "leaf" });

  const nestedRows = await sql`
    SELECT array_to_string("keyPath", '.') AS "keyPath"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath"[1:cardinality(ARRAY['root', 'branch']::text[])] = ARRAY['root', 'branch']::text[]
    ORDER BY "keyPath"
  `;

  expect(nestedRows.map((row) => row.keyPath)).toEqual([
    "root.branch",
    "root.branch.leaf",
  ]);

  const directChildrenRows = await sql`
    SELECT array_to_string("keyPath", '.') AS "keyPath"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = ARRAY['root']::text[]
      AND cardinality("keyPath") = cardinality(ARRAY['root']::text[]) + 1
    ORDER BY "keyPath"
  `;

  expect(directChildrenRows.map((row) => row.keyPath)).toEqual([
    "root.branch",
    "root.other",
  ]);

  const indexRows = await sql`
    SELECT "indexname"
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'BulldozerStorageEngine'
      AND indexname IN (
        'BulldozerStorageEngine_keyPath_key',
        'BulldozerStorageEngine_keyPathParent_idx'
      )
    ORDER BY "indexname"
  `;

  expect(indexRows.map((row) => row.indexname)).toEqual([
    "BulldozerStorageEngine_keyPathParent_idx",
    "BulldozerStorageEngine_keyPath_key",
  ]);

  const generatedColumnRows = await sql`
    SELECT attname
    FROM pg_attribute
    WHERE attrelid = 'public."BulldozerStorageEngine"'::regclass
      AND attname = 'keyPathParent'
      AND attgenerated = 's'
  `;

  expect(generatedColumnRows).toHaveLength(1);

  const fkConstraintRows = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public."BulldozerStorageEngine"'::regclass
      AND conname = 'BulldozerStorageEngine_keyPathParent_fkey'
  `;

  expect(fkConstraintRows).toHaveLength(1);

  await expect(sql`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "keyPathParent", "value")
    VALUES (
      '00000000-0000-0000-0000-000000000005'::uuid,
      ARRAY['root', 'mismatch']::text[],
      ARRAY[]::text[],
      '{"node":"invalid"}'::jsonb
    )
  `).rejects.toThrow('cannot insert a non-DEFAULT value into column "keyPathParent"');

  await expect(sql`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      '00000000-0000-0000-0000-000000000006'::uuid,
      ARRAY['missing-parent', 'child']::text[],
      '{"node":"invalid-fk"}'::jsonb
    )
  `).rejects.toThrow('BulldozerStorageEngine_keyPathParent_fkey');
};
