import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'temp_ProjectUser_contact_backfill_idx',
        'temp_ContactChannel_contactId_backfill_idx',
        'ContactChannel_tenancyId_type_value_usedForAuth_key'
      )
  `;
  expect(indexes).toHaveLength(0);
};
