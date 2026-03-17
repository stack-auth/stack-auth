import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const constraints = await sql`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid = '"ProjectUser"'::regclass
      AND conname IN (
        'ProjectUser_risk_score_bot_range',
        'ProjectUser_risk_score_free_trial_abuse_range'
      )
    ORDER BY conname
  `;

  expect(constraints).toHaveLength(2);
  for (const c of constraints) {
    expect(c.convalidated, `${c.conname} should be validated`).toBe(true);
  }

  const colInfo = await sql`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_name = 'ProjectUser' AND column_name = 'signedUpAt'
  `;
  expect(colInfo).toHaveLength(1);
  expect(colInfo[0].is_nullable).toBe('YES');
};
