import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId1 = `test-${randomUUID()}`;
  const projectId2 = `test-${randomUUID()}`;

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId1}, NOW(), NOW(), 'Local Emulator Project 1', '', false)
  `;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId2}, NOW(), NOW(), 'Local Emulator Project 2', '', false)
  `;

  return { projectId1, projectId2 };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const path1 = `/tmp/${randomUUID()}/stack.config.ts`;
  const path2 = `/tmp/${randomUUID()}/stack.config.ts`;

  await sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${path1}, ${ctx.projectId1}, NOW(), NOW())
  `;

  await expect(sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${path1}, ${ctx.projectId2}, NOW(), NOW())
  `).rejects.toThrow(/LocalEmulatorProject_pkey/);

  await expect(sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${path2}, ${ctx.projectId1}, NOW(), NOW())
  `).rejects.toThrow(/LocalEmulatorProject_projectId_key/);

  await sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${path2}, ${ctx.projectId2}, NOW(), NOW())
  `;
};
