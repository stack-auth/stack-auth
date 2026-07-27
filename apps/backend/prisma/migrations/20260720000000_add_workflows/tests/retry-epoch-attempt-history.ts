import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../test-helpers";

export const preMigration = async (sql: Sql) => {
  // All workflow tables are new in this migration, so nothing to seed.
  return {};
};

/**
 * A manual retry restarts the per-step attempt counter at 1, so without
 * retryEpoch in the key the retried attempts would collide with the original
 * execution's rows. The engine inserts attempts with skipDuplicates, so a
 * collision is silent: the run's history would still show only the original
 * failure even after the retry succeeded.
 */
export const postMigration = async (sql: Sql) => {
  const { tenancyId } = await createWorkflowTestTenancy(sql, "Workflow Retry History Test");
  const runId = randomUUID();

  await sql`
    INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "state", "triggerType", "triggerPayload", "updatedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'charge-card', 1, 'FAILED', 'user.created', '{"data":{"id":"u1"}}'::jsonb, NOW())
  `;

  // Runs start at epoch 0 so pre-existing rows keep their meaning.
  const defaults = await sql`
    SELECT "retryEpoch" FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${runId}::uuid
  `;
  expect(Array.from(defaults)).toMatchInlineSnapshot(`
    [
      {
        "retryEpoch": 0,
      },
    ]
  `);

  // Original execution: one failed attempt at epoch 0.
  await sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "retryEpoch", "attempt", "stepId", "outcome", "error", "failureKind", "startedAt", "finishedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'gated', 0, 1, 'gated', 'FAILED', '{"name":"Error","message":"too early"}'::jsonb, 'USER', NOW(), NOW())
  `;

  // Re-recording the same (step, epoch, attempt) is still rejected: within one
  // execution an attempt number is a fact, not history to be appended to.
  await expect(sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "retryEpoch", "attempt", "stepId", "outcome", "startedAt", "finishedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'gated', 0, 1, 'gated', 'SUCCEEDED', NOW(), NOW())
  `).rejects.toThrow(/WorkflowStepAttempt_pkey/);

  // The retry bumps the epoch, so attempt 1 of the retried execution coexists
  // with attempt 1 of the original instead of being swallowed.
  await sql`
    UPDATE "WorkflowRun" SET "retryEpoch" = "retryEpoch" + 1, "currentStepAttempt" = 0, "state" = 'QUEUED'
    WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${runId}::uuid
  `;
  await sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "retryEpoch", "attempt", "stepId", "outcome", "startedAt", "finishedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'gated', 1, 1, 'gated', 'SUCCEEDED', NOW(), NOW())
  `;

  const history = await sql`
    SELECT "retryEpoch", "attempt", "outcome"
    FROM "WorkflowStepAttempt"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "runId" = ${runId}::uuid
    ORDER BY "retryEpoch" ASC, "attempt" ASC
  `;
  expect(Array.from(history)).toMatchInlineSnapshot(`
    [
      {
        "attempt": 1,
        "outcome": "FAILED",
        "retryEpoch": 0,
      },
      {
        "attempt": 1,
        "outcome": "SUCCEEDED",
        "retryEpoch": 1,
      },
    ]
  `);

  // Attempts default to epoch 0 so the engine's inserts stay correct for runs
  // that were never retried. Asserted here rather than relying on a sibling
  // test that happens to omit the column.
  await sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "attempt", "stepId", "outcome", "startedAt", "finishedAt")
    VALUES (${tenancyId}::uuid, ${runId}::uuid, 'never-retried', 1, 'never-retried', 'SUCCEEDED', NOW(), NOW())
  `;
  const defaulted = await sql`
    SELECT "retryEpoch" FROM "WorkflowStepAttempt"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "runId" = ${runId}::uuid AND "stepKey" = 'never-retried'
  `;
  expect(Array.from(defaulted)).toMatchInlineSnapshot(`
    [
      {
        "retryEpoch": 0,
      },
    ]
  `);

  // Retried attempts cascade away with the run like any other attempt row.
  await sql`
    DELETE FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${runId}::uuid
  `;
  const remaining = await sql`
    SELECT COUNT(*)::int AS "stepAttempts" FROM "WorkflowStepAttempt" WHERE "tenancyId" = ${tenancyId}::uuid
  `;
  expect(Array.from(remaining)).toMatchInlineSnapshot(`
    [
      {
        "stepAttempts": 0,
      },
    ]
  `);
};
