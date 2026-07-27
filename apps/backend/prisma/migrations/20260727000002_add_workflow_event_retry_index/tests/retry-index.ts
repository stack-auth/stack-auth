import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const [index] = await sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'WorkflowEvent_outbox_idx'
  `;
  expect(index.indexdef).toContain('("processedAt", "retryAt", "scheduledAt")');
};
