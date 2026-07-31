import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const columns = await sql<{ is_nullable: string }[]>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ContactChannel'
      AND column_name = 'contactId'
  `;
  expect(columns).toEqual([{ is_nullable: "NO" }]);

  const temporaryChecks = await sql`
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ContactChannel_contactId_not_null'
  `;
  expect(temporaryChecks).toHaveLength(0);
};
