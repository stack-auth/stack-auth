import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `workflow-retry-migration-test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const eventId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Workflow Retry Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "WorkflowEvent" ("tenancyId", "id", "type", "payload")
    VALUES (${tenancyId}::uuid, ${eventId}::uuid, 'custom.test', '{}'::jsonb)
  `;

  return { tenancyId, eventId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [event] = await sql`
    SELECT "processingAttempts", "retryAt" <= NOW() AS "isReady"
    FROM "WorkflowEvent"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.eventId}::uuid
  `;
  expect(event).toMatchObject({ processingAttempts: 0, isReady: true });
};
