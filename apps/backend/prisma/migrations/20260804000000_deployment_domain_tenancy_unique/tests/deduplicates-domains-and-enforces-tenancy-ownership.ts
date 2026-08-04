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

  const serviceIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, serviceId] of serviceIds.entries()) {
    await sql`
      INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
      VALUES (${tenancyId}::uuid, ${serviceId}::uuid, NOW(), ${`service-${index}`})
    `;
  }
  const otherServiceId = randomUUID();
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${otherTenancyId}::uuid, ${otherServiceId}::uuid, NOW(), 'other-service')
  `;

  const unverifiedOldId = randomUUID();
  const verifiedNewId = randomUUID();
  const oldestTieId = randomUUID();
  const newestTieId = randomUUID();
  await sql`
    INSERT INTO "DeploymentServiceDomain"
      ("tenancyId", "id", "createdAt", "updatedAt", "deploymentServiceId", "hostname", "verified")
    VALUES
      (${tenancyId}::uuid, ${unverifiedOldId}::uuid, NOW() - INTERVAL '4 days', NOW(), ${serviceIds[0]}::uuid, 'verified-wins.example.com', false),
      (${tenancyId}::uuid, ${verifiedNewId}::uuid, NOW() - INTERVAL '3 days', NOW(), ${serviceIds[1]}::uuid, 'verified-wins.example.com', true),
      (${tenancyId}::uuid, ${oldestTieId}::uuid, NOW() - INTERVAL '2 days', NOW(), ${serviceIds[2]}::uuid, 'oldest-wins.example.com', false),
      (${tenancyId}::uuid, ${newestTieId}::uuid, NOW() - INTERVAL '1 day', NOW(), ${serviceIds[3]}::uuid, 'oldest-wins.example.com', false),
      (${otherTenancyId}::uuid, ${randomUUID()}::uuid, NOW(), NOW(), ${otherServiceId}::uuid, 'verified-wins.example.com', false)
  `;
  return { tenancyId, serviceIds, verifiedNewId, oldestTieId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const remaining = await sql<{ id: string, hostname: string }[]>`
    SELECT "id", "hostname"
    FROM "DeploymentServiceDomain"
    WHERE "tenancyId" = ${context.tenancyId}::uuid
    ORDER BY "hostname"
  `;
  expect(Array.from(remaining)).toEqual([
    { id: context.oldestTieId, hostname: "oldest-wins.example.com" },
    { id: context.verifiedNewId, hostname: "verified-wins.example.com" },
  ]);

};
