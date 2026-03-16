import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'ProjectUser'
      AND indexname IN (
        'ProjectUser_signedUpAt_asc',
        'ProjectUser_signedUpAt_desc',
        'ProjectUser_signUpIp_recent_idx',
        'ProjectUser_signUpEmailBase_recent_idx'
      )
    ORDER BY indexname
  `;

  expect(indexes.map((row) => row.indexname)).toEqual([
    'ProjectUser_signUpEmailBase_recent_idx',
    'ProjectUser_signUpIp_recent_idx',
    'ProjectUser_signedUpAt_asc',
    'ProjectUser_signedUpAt_desc',
  ]);
};
