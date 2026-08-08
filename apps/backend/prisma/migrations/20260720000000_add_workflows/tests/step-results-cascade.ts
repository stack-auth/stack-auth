import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../test-helpers";

export const preMigration = async (sql: Sql) => {
  return {};
};

export const postMigration = async (sql: Sql) => {
  const { tenancyId } = await createWorkflowTestTenancy(sql, "Workflow Step Cascade Test");
  const runId = randomUUID();

  await sql`
    INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "state", "triggerType", "triggerPayload", "updatedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'welcome-drip', 3, 'COMPLETED', 'user.created', '{"data":{"id":"u1"}}'::jsonb, NOW())
  `;
  await sql`
    INSERT INTO "WorkflowStepResult" ("tenancyId", "runId", "stepKey", "stepId", "kind", "result", "resultSizeBytes", "attempts", "executedAtVersion")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'recheck-user', 'recheck-user', 'RUN', '{"id":"u1"}'::jsonb, 12, 1, 3)
  `;
  await sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "attempt", "stepId", "outcome", "startedAt", "finishedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'recheck-user', 1, 'recheck-user', 'SUCCEEDED', NOW(), NOW())
  `;

  // A step result for a nonexistent run is rejected (composite FK).
  await expect(sql`
    INSERT INTO "WorkflowStepResult" ("tenancyId", "runId", "stepKey", "stepId", "kind", "result", "resultSizeBytes", "attempts", "executedAtVersion")
    VALUES (${tenancyId}::uuid, ${randomUUID()}::uuid, 'orphan', 'orphan', 'RUN', '{}'::jsonb, 2, 1, 1)
  `).rejects.toThrow(/WorkflowStepResult_tenancyId_runId_fkey/);

  // The same stepKey cannot be recorded twice for one run — recorded steps
  // are facts, memoized by key.
  await expect(sql`
    INSERT INTO "WorkflowStepResult" ("tenancyId", "runId", "stepKey", "stepId", "kind", "result", "resultSizeBytes", "attempts", "executedAtVersion")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'recheck-user', 'recheck-user', 'RUN', '{}'::jsonb, 2, 1, 3)
  `).rejects.toThrow(/WorkflowStepResult_pkey/);

  // Deleting the run (90-day retention pruning) cascades to its step
  // results and attempts.
  await sql`
    DELETE FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${runId}::uuid
  `;
  const remaining = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "WorkflowStepResult" WHERE "tenancyId" = ${tenancyId}::uuid) AS "stepResults",
      (SELECT COUNT(*)::int FROM "WorkflowStepAttempt" WHERE "tenancyId" = ${tenancyId}::uuid) AS "stepAttempts"
  `;
  expect(Array.from(remaining)).toMatchInlineSnapshot(`
    [
      {
        "stepAttempts": 0,
        "stepResults": 0,
      },
    ]
  `);
};
