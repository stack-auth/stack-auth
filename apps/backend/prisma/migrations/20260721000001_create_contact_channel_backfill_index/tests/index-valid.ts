import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const indexes = await sql<{ indisvalid: boolean, indisunique: boolean }[]>`
    SELECT i.indisvalid, i.indisunique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'temp_ContactChannel_contactId_backfill_idx'
  `;
  expect(indexes).toEqual([{ indisvalid: true, indisunique: false }]);
};
