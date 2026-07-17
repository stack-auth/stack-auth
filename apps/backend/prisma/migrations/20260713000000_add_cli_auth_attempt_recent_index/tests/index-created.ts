import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT
      pg_get_indexdef(index_relation.oid) AS indexdef,
      index_metadata.indisvalid,
      index_metadata.indisready
    FROM pg_index index_metadata
    JOIN pg_class index_relation
      ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_class table_relation
      ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    WHERE table_namespace.nspname = current_schema()
      AND table_relation.relname = 'CliAuthAttempt'
      AND index_relation.relname = 'CliAuthAttempt_tenancyId_createdAt_id_idx'
  `;

  expect(indexes).toHaveLength(1);
  expect(indexes[0]).toMatchObject({
    indisvalid: true,
    indisready: true,
  });
  expect(indexes[0].indexdef).toContain('("tenancyId", "createdAt" DESC, id DESC)');
};
