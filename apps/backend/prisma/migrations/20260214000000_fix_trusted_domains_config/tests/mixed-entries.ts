import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId1 = `test-${randomUUID()}`;
  const projectId2 = `test-${randomUUID()}`;
  const domainOk = randomUUID();
  const domainBroken = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId1}, NOW(), NOW(), 'Test1', '', false)`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId2}, NOW(), NOW(), 'Test2', '', false)`;

  // Project 1: correctly formatted (parent key present)
  const config1 = {
    [`domains.trustedDomains.${domainOk}`]: {},
    [`domains.trustedDomains.${domainOk}.baseUrl`]: 'https://ok.com',
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId1}, 'main', NOW(), NOW(), ${sql.json(config1)})`;

  // Project 2: broken (parent key missing)
  const config2 = {
    [`domains.trustedDomains.${domainBroken}.baseUrl`]: 'https://broken.com',
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId2}, 'main', NOW(), NOW(), ${sql.json(config2)})`;

  return { projectId1, projectId2, domainOk, domainBroken };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Project 1: unchanged
  const [row1] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId1}`;
  expect(row1.config[`domains.trustedDomains.${ctx.domainOk}`]).toEqual({});
  expect(row1.config[`domains.trustedDomains.${ctx.domainOk}.baseUrl`]).toBe('https://ok.com');

  // Project 2: parent key added
  const [row2] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId2}`;
  expect(row2.config[`domains.trustedDomains.${ctx.domainBroken}`]).toEqual({});
  expect(row2.config[`domains.trustedDomains.${ctx.domainBroken}.baseUrl`]).toBe('https://broken.com');
};
