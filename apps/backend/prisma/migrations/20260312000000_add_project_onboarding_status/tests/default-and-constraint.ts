import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Onboarding Test', '', false)
  `;
  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "onboardingStatus"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].onboardingStatus).toBe("completed");

  const validProjectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" (
      "id",
      "createdAt",
      "updatedAt",
      "displayName",
      "description",
      "isProductionMode",
      "onboardingStatus"
    )
    VALUES (${validProjectId}, NOW(), NOW(), 'Valid Status Project', '', false, 'auth_setup')
  `;

  const invalidProjectId = `test-${randomUUID()}`;
  await expect(sql`
    INSERT INTO "Project" (
      "id",
      "createdAt",
      "updatedAt",
      "displayName",
      "description",
      "isProductionMode",
      "onboardingStatus"
    )
    VALUES (${invalidProjectId}, NOW(), NOW(), 'Invalid Status Project', '', false, 'invalid_status')
  `).rejects.toThrow(/Project_onboardingStatus_valid/);

  await expect(sql`
    UPDATE "Project"
    SET "onboardingStatus" = 'invalid_status'
    WHERE "id" = ${ctx.projectId}
  `).rejects.toThrow(/Project_onboardingStatus_valid/);
};
