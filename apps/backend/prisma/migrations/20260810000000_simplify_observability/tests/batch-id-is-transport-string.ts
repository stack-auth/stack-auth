import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const tenancyId = randomUUID();
  const legacyBatchId = randomUUID();
  await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
    VALUES (${tenancyId}::uuid, ${legacyBatchId})
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
