import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const temporaryChecks = await sql<{ convalidated: boolean }[]>`
    SELECT convalidated
    FROM pg_constraint
    WHERE conname = 'ContactChannel_contactId_not_null'
  `;
  expect(temporaryChecks).toEqual([{ convalidated: true }]);
};
