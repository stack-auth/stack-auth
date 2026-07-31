import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const columns = await sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ProjectUser'
      AND column_name = 'temp_contact_backfilled'
  `;
  expect(columns).toHaveLength(0);
};

export const postMigration = async (sql: Sql) => {
  const columns = await sql<{ column_default: string, is_nullable: string }[]>`
    SELECT column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ProjectUser'
      AND column_name = 'temp_contact_backfilled'
  `;
  expect(columns).toEqual([{
    column_default: "false",
    is_nullable: "NO",
  }]);
};
