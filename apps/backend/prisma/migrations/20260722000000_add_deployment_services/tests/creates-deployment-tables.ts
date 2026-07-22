import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Deployment Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { projectId, tenancyId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('DeploymentService', 'DeploymentServiceEnvVar', 'DeploymentServiceDomain', 'DeploymentRun', 'DeploymentSourceUpload')
    ORDER BY table_name
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "DeploymentRun",
      },
      {
        "table_name": "DeploymentService",
      },
      {
        "table_name": "DeploymentServiceDomain",
      },
      {
        "table_name": "DeploymentServiceEnvVar",
      },
      {
        "table_name": "DeploymentSourceUpload",
      },
    ]
  `);

  const serviceId = randomUUID();
  const envVarId = randomUUID();
  const domainId = randomUUID();
  const runId = randomUUID();
  const uploadId = randomUUID();

  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "framework", "installCommand", "buildCommand", "outputDirectory", "rootDirectory")
    VALUES (${ctx.tenancyId}::uuid, ${serviceId}::uuid, NOW(), 'api', 'nextjs', 'pnpm install', 'pnpm build', '.next', './')
  `;
  await sql`
    INSERT INTO "DeploymentServiceEnvVar" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "key", "value", "isSecret")
    VALUES (${ctx.tenancyId}::uuid, ${envVarId}::uuid, NOW(), ${serviceId}::uuid, 'HEXCLAVE_PROJECT_ID', '{hexclave.projectId}', false)
  `;
  await sql`
    INSERT INTO "DeploymentServiceDomain" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "hostname", "isPrimary", "verified")
    VALUES (${ctx.tenancyId}::uuid, ${domainId}::uuid, NOW(), ${serviceId}::uuid, 'example.com', true, false)
  `;
  await sql`
    INSERT INTO "DeploymentRun" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "status", "target", "triggeredBy")
    VALUES (${ctx.tenancyId}::uuid, ${runId}::uuid, NOW(), ${serviceId}::uuid, 'QUEUED', 'production', 'cli')
  `;
  await sql`
    INSERT INTO "DeploymentSourceUpload" ("tenancyId", "id", "updatedAt", "data", "expiresAt")
    VALUES (${ctx.tenancyId}::uuid, ${uploadId}::uuid, NOW(), NULL, NOW() + INTERVAL '15 minutes')
  `;

  // The default run status is QUEUED, and invalid enum values are rejected.
  const run = await sql<{ status: string }[]>`
    SELECT "status" FROM "DeploymentRun" WHERE "id" = ${runId}::uuid
  `;
  expect(run[0].status).toBe("QUEUED");
  await expect(sql`
    INSERT INTO "DeploymentRun" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "status", "target", "triggeredBy")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'NOT_A_STATUS', 'production', 'cli')
  `).rejects.toThrow(/invalid input value for enum/);

  // Unique constraints: serviceId per tenancy, env var key per service, hostname per service.
  await expect(sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), 'api')
  `).rejects.toThrow(/DeploymentService_tenancyId_serviceId_key/);
  await expect(sql`
    INSERT INTO "DeploymentServiceEnvVar" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "key", "value")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'HEXCLAVE_PROJECT_ID', 'other')
  `).rejects.toThrow(/DeploymentServiceEnvVar_tenancyId_deploymentServiceId_key_key/);
  await expect(sql`
    INSERT INTO "DeploymentServiceDomain" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "hostname")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'example.com')
  `).rejects.toThrow(/DeploymentServiceDomain_tenancyId_deploymentServiceId_hostn_key/);

  // The same serviceId is allowed for a different tenancy.
  const otherProjectId = `test-${randomUUID()}`;
  const otherTenancyId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${otherProjectId}, NOW(), NOW(), 'Deployment Migration Test 2', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${otherTenancyId}::uuid, NOW(), NOW(), ${otherProjectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${otherTenancyId}::uuid, ${randomUUID()}::uuid, NOW(), 'api')
  `;

  // Foreign keys: children of a service that doesn't exist are rejected.
  await expect(sql`
    INSERT INTO "DeploymentServiceEnvVar" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "key", "value")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${randomUUID()}::uuid, 'SOME_KEY', 'some-value')
  `).rejects.toThrow(/DeploymentServiceEnvVar_tenancyId_deploymentServiceId_fkey/);
  // ... and a service can't belong to another tenancy's child rows (composite FK
  // includes tenancyId, so referencing the service from the wrong tenancy fails).
  await expect(sql`
    INSERT INTO "DeploymentRun" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "status", "target", "triggeredBy")
    VALUES (${otherTenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}::uuid, 'QUEUED', 'production', 'cli')
  `).rejects.toThrow(/DeploymentRun_tenancyId_deploymentServiceId_fkey/);
};
