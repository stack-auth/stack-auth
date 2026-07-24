import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Automation Rule Execution State Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { tenancyId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const projectUserId = randomUUID();
  const emailOutboxId = randomUUID();
  const initialSnapshot = {
    itemId: "credits",
    currentQuantity: 5,
    entitlementQuantity: 100,
    thresholdKind: "near",
    ownedProductIds: ["pro"],
    activeSubscriptionIds: ["sub_123"],
  };

  await sql`
    INSERT INTO "AutomationRuleExecutionState" (
      "tenancyId",
      "ruleId",
      "sourceType",
      "actionType",
      "subjectType",
      "subjectId",
      "signalKey",
      "lastTriggeredAt",
      "emailOutboxId",
      "lastSourceSnapshot",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'lowCreditsUpgradeEmail',
      'payments-item-quota',
      'send-email',
      'user',
      ${projectUserId},
      'credits:near',
      NOW(),
      ${emailOutboxId}::uuid,
      ${JSON.stringify(initialSnapshot)}::jsonb,
      NOW(),
      NOW()
    )
  `;

  const inserted = await sql`
    SELECT
      "sourceType",
      "actionType",
      "subjectType",
      "subjectId",
      "signalKey",
      "lastActionAt",
      "nextRetryAt",
      "emailOutboxId",
      "lastSourceSnapshot"
    FROM "AutomationRuleExecutionState"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "ruleId" = 'lowCreditsUpgradeEmail'
      AND "subjectType" = 'user'
      AND "subjectId" = ${projectUserId}
      AND "signalKey" = 'credits:near'
  `;
  expect(Array.from(inserted)).toMatchObject([{
    sourceType: "payments-item-quota",
    actionType: "send-email",
    subjectType: "user",
    subjectId: projectUserId,
    signalKey: "credits:near",
    lastActionAt: null,
    nextRetryAt: null,
    emailOutboxId,
  }]);
  expect(JSON.parse(inserted[0].lastSourceSnapshot)).toMatchObject(initialSnapshot);

  const updatedSnapshot = {
    ...initialSnapshot,
    currentQuantity: 0,
    thresholdKind: "over",
  };
  await sql`
    UPDATE "AutomationRuleExecutionState"
    SET
      "nextRetryAt" = NOW() + INTERVAL '15 minutes',
      "lastSourceSnapshot" = ${JSON.stringify(updatedSnapshot)}::jsonb,
      "updatedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "ruleId" = 'lowCreditsUpgradeEmail'
      AND "subjectType" = 'user'
      AND "subjectId" = ${projectUserId}
      AND "signalKey" = 'credits:near'
  `;

  const updated = await sql`
    SELECT "lastActionAt", "nextRetryAt", "emailOutboxId", "lastSourceSnapshot"
    FROM "AutomationRuleExecutionState"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "ruleId" = 'lowCreditsUpgradeEmail'
      AND "subjectType" = 'user'
      AND "subjectId" = ${projectUserId}
      AND "signalKey" = 'credits:near'
  `;
  expect(updated).toHaveLength(1);
  expect(updated[0].lastActionAt).toBeNull();
  expect(updated[0].nextRetryAt).toBeInstanceOf(Date);
  expect(updated[0].emailOutboxId).toBe(emailOutboxId);
  expect(JSON.parse(updated[0].lastSourceSnapshot)).toMatchObject(updatedSnapshot);

  await expect(sql`
    INSERT INTO "AutomationRuleExecutionState" (
      "tenancyId",
      "ruleId",
      "sourceType",
      "actionType",
      "subjectType",
      "subjectId",
      "signalKey",
      "lastTriggeredAt",
      "emailOutboxId",
      "lastSourceSnapshot",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'lowCreditsUpgradeEmail',
      'payments-item-quota',
      'send-email',
      'user',
      ${projectUserId},
      'credits:near',
      NOW(),
      ${randomUUID()}::uuid,
      ${JSON.stringify(initialSnapshot)}::jsonb,
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/AutomationRuleExecutionState_pkey/);

  await sql`
    DELETE FROM "Tenancy"
    WHERE "id" = ${ctx.tenancyId}::uuid
  `;

  const remaining = await sql`
    SELECT COUNT(*)::int AS count
    FROM "AutomationRuleExecutionState"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(remaining[0].count).toBe(0);
};
