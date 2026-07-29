import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Deployment Cascade Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { projectId, tenancyId };
};

const seedServiceWithChildren = async (sql: Sql, tenancyId: string, serviceId: string, serviceKey: string) => {
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${tenancyId}::uuid, ${serviceId}::uuid, NOW(), ${serviceKey})
  `;
  await sql`
    INSERT INTO "DeploymentServiceDomain" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "hostname")
    VALUES (${tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'cascade.example.com')
  `;
  await sql`
    INSERT INTO "DeploymentRun" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "status", "target", "triggeredBy")
    VALUES (${tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'READY', 'production', 'cli')
  `;
};

const countChildren = async (sql: Sql, tenancyId: string) => {
  const [domains, runs, services, uploads] = await Promise.all([
    sql`SELECT count(*)::int AS count FROM "DeploymentServiceDomain" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "DeploymentRun" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "DeploymentService" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "DeploymentSourceUpload" WHERE "tenancyId" = ${tenancyId}::uuid`,
  ]);
  return {
    services: services[0].count as number,
    domains: domains[0].count as number,
    runs: runs[0].count as number,
    uploads: uploads[0].count as number,
  };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Deleting a service cascades to its domains and runs.
  const serviceId = randomUUID();
  await seedServiceWithChildren(sql, ctx.tenancyId, serviceId, "cascade-a");
  await sql`
    INSERT INTO "DeploymentSourceUpload" ("tenancyId", "id", "updatedAt", "objectKey", "expiresAt")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${`deployment-source-uploads/${ctx.tenancyId}/${randomUUID()}.tar.gz`}, NOW() + INTERVAL '15 minutes')
  `;
  expect(await countChildren(sql, ctx.tenancyId)).toEqual({ services: 1, domains: 1, runs: 1, uploads: 1 });

  await sql`DELETE FROM "DeploymentService" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${serviceId}::uuid`;
  expect(await countChildren(sql, ctx.tenancyId)).toEqual({ services: 0, domains: 0, runs: 0, uploads: 1 });

  // Deleting the project cascades through the tenancy to all deployment rows.
  await seedServiceWithChildren(sql, ctx.tenancyId, randomUUID(), "cascade-b");
  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;
  expect(await countChildren(sql, ctx.tenancyId)).toEqual({ services: 0, domains: 0, runs: 0, uploads: 0 });
};
