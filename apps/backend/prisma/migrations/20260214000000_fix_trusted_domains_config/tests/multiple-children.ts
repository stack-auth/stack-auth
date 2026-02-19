import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const domainId1 = randomUUID();
  const domainId2 = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;

  // Two different domains, both missing parent keys
  const config = {
    [`domains.trustedDomains.${domainId1}.baseUrl`]: 'https://one.com',
    [`domains.trustedDomains.${domainId1}.handlerPath`]: '/one',
    [`domains.trustedDomains.${domainId2}.baseUrl`]: 'https://two.com',
    [`domains.trustedDomains.${domainId2}.handlerPath`]: '/two',
    [`domains.trustedDomains.${domainId2}.extra`]: 'data',
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(config)})`;

  return { projectId, domainId1, domainId2 };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [row] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId}`;

  // Both parent keys should be added
  expect(row.config[`domains.trustedDomains.${ctx.domainId1}`]).toEqual({});
  expect(row.config[`domains.trustedDomains.${ctx.domainId2}`]).toEqual({});

  // All child keys preserved
  expect(row.config[`domains.trustedDomains.${ctx.domainId1}.baseUrl`]).toBe('https://one.com');
  expect(row.config[`domains.trustedDomains.${ctx.domainId1}.handlerPath`]).toBe('/one');
  expect(row.config[`domains.trustedDomains.${ctx.domainId2}.baseUrl`]).toBe('https://two.com');
  expect(row.config[`domains.trustedDomains.${ctx.domainId2}.handlerPath`]).toBe('/two');
  expect(row.config[`domains.trustedDomains.${ctx.domainId2}.extra`]).toBe('data');
};
