import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const otherProjectId = `test-${randomUUID()}`;
  const otherTenancyId = randomUUID();
  for (const id of [projectId, otherProjectId]) {
    await sql`
      INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
      VALUES (${id}, NOW(), NOW(), 'Domain uniqueness migration test', '', false)
    `;
  }
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES
      (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue"),
      (${otherTenancyId}::uuid, NOW(), NOW(), ${otherProjectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  const firstServiceId = randomUUID();
  const secondServiceId = randomUUID();
  const otherServiceId = randomUUID();
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES
      (${tenancyId}::uuid, ${firstServiceId}::uuid, NOW(), 'first-service'),
      (${tenancyId}::uuid, ${secondServiceId}::uuid, NOW(), 'second-service'),
      (${otherTenancyId}::uuid, ${otherServiceId}::uuid, NOW(), 'other-service')
  `;

  const firstDomainId = randomUUID();
  const secondDomainId = randomUUID();
  const otherDomainId = randomUUID();
  await sql`
    INSERT INTO "DeploymentServiceDomain"
      ("tenancyId", "id", "createdAt", "updatedAt", "deploymentServiceId", "hostname", "verified")
    VALUES
      (${tenancyId}::uuid, ${firstDomainId}::uuid, NOW(), NOW(), ${firstServiceId}::uuid, 'shared.example.com', true),
      (${tenancyId}::uuid, ${secondDomainId}::uuid, NOW(), NOW(), ${secondServiceId}::uuid, 'second.example.com', false),
      (${otherTenancyId}::uuid, ${otherDomainId}::uuid, NOW(), NOW(), ${otherServiceId}::uuid, 'shared.example.com', false)
  `;
  return { firstDomainId, secondDomainId, otherDomainId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const remaining = await sql<{ id: string }[]>`
    SELECT "id"
    FROM "DeploymentServiceDomain"
    WHERE "id" IN (${context.firstDomainId}::uuid, ${context.secondDomainId}::uuid, ${context.otherDomainId}::uuid)
    ORDER BY "id"
  `;
  expect(Array.from(remaining, (row) => row.id)).toEqual([
    context.firstDomainId,
    context.secondDomainId,
    context.otherDomainId,
  ].sort());
};
