import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT
      index_relation.relname AS index_name,
      pg_get_indexdef(index_relation.oid) AS indexdef,
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indisunique
    FROM pg_index index_metadata
    JOIN pg_class index_relation ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
    WHERE table_namespace.nspname = current_schema()
      AND table_relation.relname IN ('ExperimentRun', 'FeatureFlagAuditLog')
  `;
  const byName = new Map(indexes.map((row) => [row.index_name as string, row]));

  const activeKey = byName.get('ExperimentRun_active_run_key');
  expect(activeKey).toBeDefined();
  expect(activeKey).toMatchObject({ indisvalid: true, indisready: true, indisunique: true });
  expect(activeKey!.indexdef).toContain(`WHERE (state = ANY (ARRAY['RUNNING'::"ExperimentRunState", 'PAUSED'::"ExperimentRunState"]))`);
  expect(activeKey!.indexdef).toContain('("projectId", "branchId", "experimentId")');

  for (const name of [
    'ExperimentRun_project_experiment_createdAt_idx',
    'ExperimentRun_state_scheduledStartAt_idx',
    'ExperimentRun_state_scheduledEndAt_idx',
    'FeatureFlagAuditLog_resource_createdAt_idx',
    'FeatureFlagAuditLog_project_createdAt_idx',
  ]) {
    const index = byName.get(name);
    expect(index, `expected index ${name} to exist`).toBeDefined();
    expect(index).toMatchObject({ indisvalid: true, indisready: true });
  }
};
