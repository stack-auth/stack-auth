import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const rows = await sql`
    SELECT "convalidated"
    FROM "pg_constraint"
    WHERE "conname" = 'Project_onboardingStatus_valid'
  `;

  expect(rows).toHaveLength(1);
  expect(rows[0].convalidated).toBe(true);
};
