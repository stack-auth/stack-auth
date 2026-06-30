import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const localEmulatorProjectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Development Environment Flag Project', '', false)
  `;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${localEmulatorProjectId}, NOW(), NOW(), 'Existing Local Emulator Project', '', false)
  `;
  await sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${`/tmp/${randomUUID()}/stack.config.ts`}, ${localEmulatorProjectId}, NOW(), NOW())
  `;
  return { projectId, localEmulatorProjectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "isDevelopmentEnvironment"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].isDevelopmentEnvironment).toBe(false);

  const localEmulatorRows = await sql`
    SELECT "isDevelopmentEnvironment"
    FROM "Project"
    WHERE "id" = ${ctx.localEmulatorProjectId}
  `;
  expect(localEmulatorRows).toHaveLength(1);
  expect(localEmulatorRows[0].isDevelopmentEnvironment).toBe(true);
};
