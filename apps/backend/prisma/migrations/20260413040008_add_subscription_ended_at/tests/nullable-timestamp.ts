import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  const subId = randomUUID();
  await sql`
    INSERT INTO "Subscription" ("id", "tenancyId", "createdAt", "updatedAt", "customerId", "customerType", "status", "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "quantity", "creationSource", "product")
    VALUES (${subId}::uuid, ${tenancyId}::uuid, NOW(), NOW(), ${randomUUID()}, 'USER', 'active', NOW(), NOW() + INTERVAL '30 days', false, 1, 'TEST_MODE', '{}')
  `;

  return { tenancyId, subId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "endedAt"
    FROM "Subscription"
    WHERE "id" = ${ctx.subId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].endedAt).toBeNull();

  // Verify the column accepts a timestamp value
  await sql`
    UPDATE "Subscription"
    SET "endedAt" = NOW()
    WHERE "id" = ${ctx.subId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  const updated = await sql`
    SELECT "endedAt"
    FROM "Subscription"
    WHERE "id" = ${ctx.subId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(updated[0].endedAt).toBeInstanceOf(Date);
};
