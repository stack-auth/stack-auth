import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const constraints = await sql<{ convalidated: boolean }[]>`
    SELECT "convalidated"
    FROM "pg_constraint"
    WHERE "conname" = 'GtmNote_title_length_check'
  `;

  expect(constraints).toEqual([{ convalidated: true }]);
};
