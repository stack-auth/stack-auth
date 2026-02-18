import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const domainId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;

  // Config with child keys but MISSING parent key
  const config = {
    [`domains.trustedDomains.${domainId}.baseUrl`]: 'https://example.com',
    [`domains.trustedDomains.${domainId}.handlerPath`]: '/handler',
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(config)})`;

  return { projectId, domainId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [row] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId}`;
  const parentKey = `domains.trustedDomains.${ctx.domainId}`;

  // Parent key should now exist as an empty object
  expect(row.config).toHaveProperty(parentKey);
  expect(row.config[parentKey]).toEqual({});

  // Child keys should still be present and unchanged
  expect(row.config[`${parentKey}.baseUrl`]).toBe('https://example.com');
  expect(row.config[`${parentKey}.handlerPath`]).toBe('/handler');
};
