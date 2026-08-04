import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../test-helpers";

// The outbox backs off failed dispatches so one poison event cannot monopolize
// the oldest batch. A freshly inserted event must be immediately eligible
// (zero attempts, retryAt already elapsed), and the outbox index must lead with
// processedAt so unprocessed rows stay contiguous, then filter on retryAt.
export const postMigration = async (sql: Sql) => {
  const { tenancyId } = await createWorkflowTestTenancy(sql, "Workflow Retry Backoff Test");
  const eventId = randomUUID();

  await sql`
    INSERT INTO "WorkflowEvent" ("tenancyId", "id", "type", "payload")
    VALUES (${tenancyId}::uuid, ${eventId}::uuid, 'custom.test', '{}'::jsonb)
  `;

  const [event] = await sql`
    SELECT "processingAttempts", "retryAt" <= NOW() AS "isReady"
    FROM "WorkflowEvent"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${eventId}::uuid
  `;
  expect(event).toMatchObject({ processingAttempts: 0, isReady: true });

  const [index] = await sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'WorkflowEvent_outbox_idx'
  `;
  expect(index.indexdef).toContain('("processedAt", "retryAt", "scheduledAt")');
};
