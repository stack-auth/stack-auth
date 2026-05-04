import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Auth Migration Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  return { projectId, tenancyId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const jobId = randomUUID();

  await sql`
    INSERT INTO "AuthDataMigrationJob" (
      "tenancyId", "id", "projectId", "branchId", "provider", "encryptedCredentials"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${jobId}::uuid, ${ctx.projectId}, 'main', 'better_auth', '{"ciphertext_base64":"abc"}'::jsonb
    )
  `;

  const rows = await sql`
    SELECT "status", "attemptCount", "maxAttempts"
    FROM "AuthDataMigrationJob"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${jobId}::uuid
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("PENDING");
  expect(rows[0].attemptCount).toBe(0);
  expect(rows[0].maxAttempts).toBe(5);

  await expect(sql`
    INSERT INTO "AuthDataMigrationJob" (
      "tenancyId", "projectId", "branchId", "provider", "status", "encryptedCredentials"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.projectId}, 'main', 'unknown', 'PENDING', '{"ciphertext_base64":"abc"}'::jsonb
    )
  `).rejects.toThrow(/AuthDataMigrationJob_provider_valid/);

  await expect(sql`
    UPDATE "AuthDataMigrationJob"
    SET "status" = 'SUCCEEDED', "finishedAt" = NULL
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${jobId}::uuid
  `).rejects.toThrow(/AuthDataMigrationJob_terminal_finished/);
};
