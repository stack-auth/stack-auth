import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" (
      "id", "createdAt", "updatedAt", "displayName", "description",
      "isProductionMode", "onboardingStatus"
    )
    VALUES (${projectId}, NOW(), NOW(), 'Welcome Test', '', false, 'completed')
  `;

  await expect(sql`
    UPDATE "Project"
    SET "onboardingStatus" = 'welcome'
    WHERE "id" = ${projectId}
  `).rejects.toThrow(/Project_onboardingStatus_valid/);

  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  await sql`
    UPDATE "Project"
    SET "onboardingStatus" = 'welcome'
    WHERE "id" = ${ctx.projectId}
  `;

  const rows = await sql`
    SELECT "onboardingStatus"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].onboardingStatus).toBe("welcome");

  const insertWelcomeProjectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" (
      "id", "createdAt", "updatedAt", "displayName", "description",
      "isProductionMode", "onboardingStatus"
    )
    VALUES (${insertWelcomeProjectId}, NOW(), NOW(), 'Welcome Insert Test', '', false, 'welcome')
  `;

  const insertedRows = await sql`
    SELECT "onboardingStatus"
    FROM "Project"
    WHERE "id" = ${insertWelcomeProjectId}
  `;
  expect(insertedRows).toHaveLength(1);
  expect(insertedRows[0].onboardingStatus).toBe("welcome");

  const insertInvalidProjectId = `test-${randomUUID()}`;
  await expect(sql`
    INSERT INTO "Project" (
      "id", "createdAt", "updatedAt", "displayName", "description",
      "isProductionMode", "onboardingStatus"
    )
    VALUES (${insertInvalidProjectId}, NOW(), NOW(), 'Invalid Status Insert', '', false, 'invalid_status')
  `).rejects.toThrow(/Project_onboardingStatus_valid/);

  await expect(sql`
    UPDATE "Project"
    SET "onboardingStatus" = 'invalid_status'
    WHERE "id" = ${ctx.projectId}
  `).rejects.toThrow(/Project_onboardingStatus_valid/);
};
