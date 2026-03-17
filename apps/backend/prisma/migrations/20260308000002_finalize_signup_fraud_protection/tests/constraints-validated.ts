import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const triggers = await sql`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = '"ProjectUser"'::regclass
      AND tgname = 'ProjectUser_set_signedUpAt_from_createdAt'
      AND NOT tgisinternal
  `;
  expect(triggers).toHaveLength(1);

  const constraints = await sql`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid = '"ProjectUser"'::regclass
      AND conname IN (
        'ProjectUser_risk_score_bot_range',
        'ProjectUser_risk_score_free_trial_abuse_range',
        'ProjectUser_signedUpAt_not_null'
      )
    ORDER BY conname
  `;

  expect(constraints).toHaveLength(3);
  for (const c of constraints) {
    expect(c.convalidated, `${c.conname} should be validated`).toBe(true);
  }

  const colInfo = await sql`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'ProjectUser' AND column_name = 'signedUpAt'
  `;
  expect(colInfo).toHaveLength(1);
  expect(colInfo[0].is_nullable).toBe('NO');
  expect(colInfo[0].column_default).toBe(null);
};
