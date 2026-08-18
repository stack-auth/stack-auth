import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  // The test database is built from the CURRENT migration files, where
  // 20260731000000_add_issues already creates batchId as VARCHAR(512) — so
  // without intervention the migration's uuid->varchar compatibility branch
  // would never fire and a regression in it would go undetected. Recreate the
  // legacy pre-release shape (a genuine uuid column) first, so the migration
  // under test performs the actual conversion. Earlier migrations' tests only
  // ever insert uuid-shaped batch ids, so the USING cast cannot fail on their
  // leftover rows.
  await sql`
    ALTER TABLE "IssueMaterialization"
      ALTER COLUMN "batchId" TYPE UUID
      USING "batchId"::uuid
  `;
  const tenancyId = randomUUID();
  const legacyBatchId = randomUUID();
  await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
    VALUES (${tenancyId}::uuid, ${legacyBatchId}::uuid)
  `;
  return { tenancyId, legacyBatchId };
};

export const postMigration = async (
  sql: Sql,
  ctx: Awaited<ReturnType<typeof preMigration>>,
) => {
  const columns = await sql<{ data_type: string, character_maximum_length: number | null }[]>`
    SELECT data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'IssueMaterialization'
      AND column_name = 'batchId'
  `;
  expect(columns).toEqual([{ data_type: "character varying", character_maximum_length: 512 }]);
  const batchId = "envelope:" + "a".repeat(32);
  await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
    VALUES (${ctx.tenancyId}::uuid, ${batchId})
  `;
  const row = await sql<{ batch_id: string }[]>`
    SELECT "batchId" AS batch_id
    FROM "IssueMaterialization"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "batchId" = ${batchId}
  `;
  expect(row).toEqual([{ batch_id: batchId }]);
  const legacyRow = await sql<{ batch_id: string }[]>`
    SELECT "batchId" AS batch_id
    FROM "IssueMaterialization"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "batchId" = ${ctx.legacyBatchId}
  `;
  expect(legacyRow).toEqual([{ batch_id: ctx.legacyBatchId }]);
  await sql`
    DELETE FROM "IssueMaterialization"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "batchId" IN (${batchId}, ${ctx.legacyBatchId})
  `;
};
