import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;

  const config = { 'auth.allowSignUp': true, 'payments.testMode': true, 'some.nested.value': 42 };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(config)})`;

  return { projectId, originalConfig: config };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [row] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId}`;
  expect(row.config).toEqual(ctx.originalConfig);
};
