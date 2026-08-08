import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Service visibility migration test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  const existingServiceId = randomUUID();
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${tenancyId}::uuid, ${existingServiceId}::uuid, NOW(), 'pre-existing-service')
  `;
  return { tenancyId, existingServiceId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const [existing] = await sql<{ visibility: string, transport: string }[]>`
    SELECT "visibility", "transport" FROM "DeploymentService" WHERE "id" = ${context.existingServiceId}::uuid
  `;
  expect(existing.visibility).toBe("private");
  expect(existing.transport).toBe("http");

  const insertService = async (serviceId: string, visibility: string) => {
    await sql`
      INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "visibility")
      VALUES (${context.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}, ${visibility})
    `;
  };
  await insertService("public-service", "public");
  await insertService("private-service", "private");
  await expect(insertService("invalid-service", "unlisted")).rejects.toThrow(/DeploymentService_visibility_check/);

  const insertTransportService = async (serviceId: string, transport: string, visibility: string) => {
    await sql`
      INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "transport", "visibility")
      VALUES (${context.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}, ${transport}, ${visibility})
    `;
  };
  await insertTransportService("tcp-service", "tcp", "private");
  await expect(insertTransportService("invalid-transport", "udp", "private")).rejects.toThrow(/DeploymentService_transport_check/);
  await expect(insertTransportService("public-tcp", "tcp", "public")).rejects.toThrow(/DeploymentService_tcp_private_check/);
};
