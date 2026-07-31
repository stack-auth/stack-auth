import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const constraints = await sql<{ convalidated: boolean }[]>`
    SELECT convalidated
    FROM pg_constraint
    WHERE conname = 'ContactChannel_legacy_project_user_fkey'
  `;
  expect(constraints).toEqual([{ convalidated: true }]);
};
