import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const firstServiceId = randomUUID();
  const secondServiceId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Domain unique index migration test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES
      (${tenancyId}::uuid, ${firstServiceId}::uuid, NOW(), 'first'),
      (${tenancyId}::uuid, ${secondServiceId}::uuid, NOW(), 'second')
  `;
  await sql`
    INSERT INTO "DeploymentServiceDomain" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "hostname")
    VALUES (${tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${firstServiceId}::uuid, 'unique-index.example.com')
  `;
  await expect(sql`
    INSERT INTO "DeploymentServiceDomain" ("tenancyId", "id", "updatedAt", "deploymentServiceId", "hostname")
    VALUES (${tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${secondServiceId}::uuid, 'unique-index.example.com')
  `).rejects.toThrow(/DeploymentServiceDomain_tenancyId_hostname_key/);

  const indexes = await sql<{ index_name: string, is_valid: boolean, is_ready: boolean }[]>`
    SELECT index_class.relname AS index_name, index.indisvalid AS is_valid, index.indisready AS is_ready
    FROM pg_index index
    INNER JOIN pg_class index_class ON index_class.oid = index.indexrelid
    WHERE index_class.relname LIKE 'DeploymentServiceDomain_tenancy%'
    ORDER BY index_class.relname
  `;
  expect(Array.from(indexes)).toEqual([{
    index_name: "DeploymentServiceDomain_tenancyId_hostname_key",
    is_valid: true,
    is_ready: true,
  }]);
};
