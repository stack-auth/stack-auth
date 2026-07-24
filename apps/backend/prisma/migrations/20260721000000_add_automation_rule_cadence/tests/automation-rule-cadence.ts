import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Automation Rule Cadence Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  const activeCheckpointUpdatedAt = new Date("2026-07-21T11:30:00.000Z");
  await sql`
    INSERT INTO "AutomationSchedulerState" (
      "key", "activeTenancyId", "activeRuleId", "updatedAt"
    ) VALUES (
      'usage-email-cadence-backfill-test', ${tenancyId}::uuid, 'usage-upgrade', ${activeCheckpointUpdatedAt}
    )
  `;

  return { tenancyId, activeCheckpointUpdatedAt };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const schedulerRows = await sql`
    SELECT "activeRuleId", "activeRuleEvaluationStartedAt"
    FROM "AutomationSchedulerState"
    WHERE "key" = 'usage-email-v1'
  `;
  expect(Array.from(schedulerRows)).toEqual([{
    activeRuleId: null,
    activeRuleEvaluationStartedAt: null,
  }]);

  const backfilledCheckpoint = await sql`
    SELECT "activeRuleId", "activeRuleEvaluationStartedAt"
    FROM "AutomationSchedulerState"
    WHERE "key" = 'usage-email-cadence-backfill-test'
  `;
  expect(Array.from(backfilledCheckpoint)).toEqual([{
    activeRuleId: "usage-upgrade",
    activeRuleEvaluationStartedAt: ctx.activeCheckpointUpdatedAt,
  }]);

  const completedStartedAt = new Date("2026-07-21T12:00:00.000Z");
  await sql`
    INSERT INTO "AutomationRuleScheduleState" (
      "tenancyId", "ruleId", "lastCompletedEvaluationStartedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${ctx.tenancyId}::uuid, 'usage-upgrade', ${completedStartedAt}, NOW(), NOW()
    )
  `;

  const inserted = await sql`
    SELECT "ruleId", "lastCompletedEvaluationStartedAt"
    FROM "AutomationRuleScheduleState"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(Array.from(inserted)).toEqual([{
    ruleId: "usage-upgrade",
    lastCompletedEvaluationStartedAt: completedStartedAt,
  }]);

  await expect(sql`
    INSERT INTO "AutomationRuleScheduleState" (
      "tenancyId", "ruleId", "lastCompletedEvaluationStartedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${ctx.tenancyId}::uuid, 'usage-upgrade', ${completedStartedAt}, NOW(), NOW()
    )
  `).rejects.toThrow(/AutomationRuleScheduleState_pkey/);

  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'AutomationRuleExecutionState_tenancy_rule_retry_idx'
  `;
  expect(Array.from(indexes)).toEqual([{
    indexname: "AutomationRuleExecutionState_tenancy_rule_retry_idx",
  }]);

  await sql`DELETE FROM "Tenancy" WHERE "id" = ${ctx.tenancyId}::uuid`;
  const remaining = await sql`
    SELECT COUNT(*)::int AS count
    FROM "AutomationRuleScheduleState"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(remaining[0].count).toBe(0);
  await sql`DELETE FROM "AutomationSchedulerState" WHERE "key" = 'usage-email-cadence-backfill-test'`;
};
