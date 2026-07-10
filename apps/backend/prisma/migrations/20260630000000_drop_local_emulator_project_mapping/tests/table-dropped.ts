import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const absoluteFilePath = `/tmp/${randomUUID()}/stack.config.ts`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Local Emulator Project', '', false)
  `;
  await sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${absoluteFilePath}, ${projectId}, NOW(), NOW())
  `;
  return { projectId, absoluteFilePath };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'LocalEmulatorProject'
  `;
  expect(rows).toHaveLength(0);

  const projectRows = await sql`
    SELECT "id"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(projectRows).toHaveLength(1);
};
