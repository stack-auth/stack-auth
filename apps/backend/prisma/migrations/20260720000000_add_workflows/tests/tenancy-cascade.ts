import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../test-helpers";

export const preMigration = async (sql: Sql) => {
  return await createWorkflowTestTenancy(sql, "Workflow Cascade Test");
};

const countWorkflowRows = async (sql: Sql, tenancyId: string) => {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "WorkflowDefinition" WHERE "tenancyId" = ${tenancyId}::uuid) AS "definitions",
      (SELECT COUNT(*)::int FROM "WorkflowVersion" WHERE "tenancyId" = ${tenancyId}::uuid) AS "versions",
      (SELECT COUNT(*)::int FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid) AS "runs",
      (SELECT COUNT(*)::int FROM "WorkflowStepResult" WHERE "tenancyId" = ${tenancyId}::uuid) AS "stepResults",
      (SELECT COUNT(*)::int FROM "WorkflowStepAttempt" WHERE "tenancyId" = ${tenancyId}::uuid) AS "stepAttempts",
      (SELECT COUNT(*)::int FROM "WorkflowEvent" WHERE "tenancyId" = ${tenancyId}::uuid) AS "events",
      (SELECT COUNT(*)::int FROM "WorkflowScheduleCursor" WHERE "tenancyId" = ${tenancyId}::uuid) AS "scheduleCursors"
  `;
  return rows[0];
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const runId = randomUUID();

  await sql`
    INSERT INTO "WorkflowDefinition" ("tenancyId", "workflowId", "displayName", "latestVersion", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, 'cascade-test', 'Cascade Test', 1, NOW())
  `;
  await sql`
    INSERT INTO "WorkflowVersion" ("tenancyId", "workflowId", "version", "source", "sourceHash", "compiledBundle", "runtimeEnvVersion", "manifest")
    VALUES (${ctx.tenancyId}::uuid, 'cascade-test', 1, 'source', 'hash', 'bundle', 'test', '{"triggers":[]}'::jsonb)
  `;
  await sql`
    INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "state", "triggerType", "triggerPayload", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${runId}::uuid, 'cascade-test', 1, 'COMPLETED', 'custom.test', '{}'::jsonb, NOW())
  `;
  await sql`
    INSERT INTO "WorkflowStepResult" ("tenancyId", "runId", "stepKey", "stepId", "kind", "result", "resultSizeBytes", "attempts", "executedAtVersion")
    VALUES (${ctx.tenancyId}::uuid, ${runId}::uuid, 'step', 'step', 'RUN', '{}'::jsonb, 2, 1, 1)
  `;
  await sql`
    INSERT INTO "WorkflowStepAttempt" ("tenancyId", "runId", "stepKey", "attempt", "stepId", "outcome", "startedAt", "finishedAt")
    VALUES (${ctx.tenancyId}::uuid, ${runId}::uuid, 'step', 1, 'step', 'SUCCEEDED', NOW(), NOW())
  `;
  await sql`
    INSERT INTO "WorkflowEvent" ("tenancyId", "id", "type", "payload")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 'custom.test', '{}'::jsonb)
  `;
  await sql`
    INSERT INTO "WorkflowScheduleCursor" ("tenancyId", "workflowId", "scheduleKey", "lastMaterializedAt", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, 'cascade-test', '* * * * *|UTC', NOW(), NOW())
  `;

  expect(await countWorkflowRows(sql, ctx.tenancyId)).toEqual({
    definitions: 1,
    versions: 1,
    runs: 1,
    stepResults: 1,
    stepAttempts: 1,
    events: 1,
    scheduleCursors: 1,
  });
  // Project deletion cascades through Tenancy. Workflow roots must follow it,
  // and step history follows WorkflowRun, so no source or event payloads are
  // retained after the tenant is gone.
  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;
  expect(await countWorkflowRows(sql, ctx.tenancyId)).toEqual({
    definitions: 0,
    versions: 0,
    runs: 0,
    stepResults: 0,
    stepAttempts: 0,
    events: 0,
    scheduleCursors: 0,
  });
};
