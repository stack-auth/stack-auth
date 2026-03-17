import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'ProjectUser'
      AND indexname IN (
        'ProjectUser_signedUpAt_asc',
        'ProjectUser_signUpIp_recent_idx',
        'ProjectUser_signUpEmailBase_recent_idx'
      )
    ORDER BY indexname
  `;

  expect(indexes.map((row) => row.indexname)).toEqual([
    'ProjectUser_signUpEmailBase_recent_idx',
    'ProjectUser_signUpIp_recent_idx',
    'ProjectUser_signedUpAt_asc',
  ]);

  // Verify column order and sort directions in the index definitions
  const indexDefByName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));

  expect(indexDefByName['ProjectUser_signedUpAt_asc']).toContain('"tenancyId", "signedUpAt"');
  expect(indexDefByName['ProjectUser_signUpIp_recent_idx']).toContain('"tenancyId", "signUpIp", "signedUpAt"');
  expect(indexDefByName['ProjectUser_signUpEmailBase_recent_idx']).toContain('"tenancyId", "signUpEmailBase", "signedUpAt"');
};
