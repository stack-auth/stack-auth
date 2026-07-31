import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const indexes = await sql<{ indisvalid: boolean, indisunique: boolean }[]>`
    SELECT i.indisvalid, i.indisunique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'ContactChannel_tenancyId_contactId_type_identityScope_value_key'
  `;
  expect(indexes).toEqual([{ indisvalid: true, indisunique: true }]);
};
