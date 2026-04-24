import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `email-outbox-status-${randomUUID()}`;
  const tenancyId = randomUUID();
  const delayedEmailId = randomUUID();
  const renderedByWorkerId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Email Outbox Status Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "EmailOutbox" (
      "tenancyId",
      "id",
      "updatedAt",
      "tsxSource",
      "isHighPriority",
      "to",
      "extraRenderVariables",
      "createdWith",
      "shouldSkipDeliverabilityCheck",
      "renderedByWorkerId",
      "startedRenderingAt",
      "finishedRenderingAt",
      "renderedHtml",
      "renderedText",
      "renderedSubject",
      "renderedIsTransactional",
      "scheduledAt",
      "isQueued",
      "startedSendingAt",
      "finishedSendingAt",
      "canHaveDeliveryInfo",
      "deliveryDelayedAt"
    ) VALUES (
      ${tenancyId}::uuid,
      ${delayedEmailId}::uuid,
      NOW(),
      'export function Email() { return null; }',
      false,
      '{"type":"custom-emails","emails":["test@example.com"]}'::jsonb,
      '{}'::jsonb,
      'PROGRAMMATIC_CALL'::"EmailOutboxCreatedWith",
      false,
      ${renderedByWorkerId}::uuid,
      NOW(),
      NOW(),
      '<p>Test</p>',
      'Test',
      'Test',
      true,
      NOW(),
      true,
      NOW(),
      NOW(),
      true,
      NOW()
    )
  `;

  return { tenancyId, delayedEmailId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const triggerRows = await sql`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = '"EmailOutbox"'::regclass
      AND tgname IN ('EmailOutbox_status_v2_trigger', 'EmailOutbox_status_trigger')
  `;
  expect(triggerRows).toHaveLength(0);

  const delayedRows = await sql`
    SELECT "status"
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.delayedEmailId}::uuid
  `;
  expect(delayedRows).toHaveLength(1);
  expect(delayedRows[0].status).toBe('DELIVERY_DELAYED');

  await sql`
    UPDATE "EmailOutbox"
    SET "markedAsSpamAt" = NOW(),
        "status" = 'MARKED_AS_SPAM'::"EmailOutboxStatus"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.delayedEmailId}::uuid
  `;
  const complainedRows = await sql`
    SELECT "status"
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.delayedEmailId}::uuid
  `;
  expect(complainedRows).toHaveLength(1);
  expect(complainedRows[0].status).toBe('MARKED_AS_SPAM');

  const preparingEmailId = randomUUID();
  await sql`
    INSERT INTO "EmailOutbox" (
      "tenancyId",
      "id",
      "updatedAt",
      "tsxSource",
      "isHighPriority",
      "to",
      "extraRenderVariables",
      "createdWith",
      "shouldSkipDeliverabilityCheck",
      "scheduledAt"
    ) VALUES (
      ${ctx.tenancyId}::uuid,
      ${preparingEmailId}::uuid,
      NOW(),
      'export function Email() { return null; }',
      false,
      '{"type":"custom-emails","emails":["test@example.com"]}'::jsonb,
      '{}'::jsonb,
      'PROGRAMMATIC_CALL'::"EmailOutboxCreatedWith",
      false,
      NOW()
    )
  `;
  const preparingRows = await sql`
    SELECT "status"
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${preparingEmailId}::uuid
  `;
  expect(preparingRows).toHaveLength(1);
  expect(preparingRows[0].status).toBe('PREPARING');
};
