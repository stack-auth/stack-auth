import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  // Verify constraints are fully validated (not just NOT VALID)
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
  expect(constraints[0].conname).toBe('ProjectUser_risk_score_bot_range');
  expect(constraints[0].convalidated).toBe(true);
  expect(constraints[1].conname).toBe('ProjectUser_risk_score_free_trial_abuse_range');
  expect(constraints[1].convalidated).toBe(true);
};
