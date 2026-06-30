import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Cascade Test Project', '', false)
  `;
  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const absoluteFilePath = `/tmp/${randomUUID()}/stack.config.ts`;

  await sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${absoluteFilePath}, ${ctx.projectId}, NOW(), NOW())
  `;

  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;

  const rows = await sql`
    SELECT "absoluteFilePath"
    FROM "LocalEmulatorProject"
    WHERE "absoluteFilePath" = ${absoluteFilePath}
  `;
  expect(rows).toHaveLength(0);
};
