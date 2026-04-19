import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const columnRows = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'Subscription'
      AND column_name = 'canceledAt'
  `;
  expect(columnRows).toHaveLength(1);
  expect(columnRows[0].is_nullable).toBe("YES");
  expect(columnRows[0].data_type).toBe("timestamp without time zone");
};
