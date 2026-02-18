import type { Sql } from 'postgres';
import { expect } from 'vitest';

// No preMigration needed - we just verify cleanup after the migration runs

export const postMigration = async (sql: Sql) => {
  // Temporary column should NOT exist after migration
  const columns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'EnvironmentConfigOverride'
    AND column_name = 'temp_trusted_domains_checked'
  `;
  expect(columns).toHaveLength(0);

  // Temporary index should NOT exist after migration
  const indices = await sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname = 'temp_eco_trusted_domains_checked_idx'
  `;
  expect(indices).toHaveLength(0);
};
