import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const domainId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;

  // Config that already has both parent AND child keys (correct format)
  const config = {
    [`domains.trustedDomains.${domainId}`]: {},
    [`domains.trustedDomains.${domainId}.baseUrl`]: 'https://correct.com',
    [`domains.trustedDomains.${domainId}.handlerPath`]: '/api',
    'some.other.key': 'untouched',
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(config)})`;

  return { projectId, domainId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [row] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId}`;

  expect(row.config[`domains.trustedDomains.${ctx.domainId}`]).toEqual({});
  expect(row.config[`domains.trustedDomains.${ctx.domainId}.baseUrl`]).toBe('https://correct.com');
  expect(row.config[`domains.trustedDomains.${ctx.domainId}.handlerPath`]).toBe('/api');
  expect(row.config['some.other.key']).toBe('untouched');
};
