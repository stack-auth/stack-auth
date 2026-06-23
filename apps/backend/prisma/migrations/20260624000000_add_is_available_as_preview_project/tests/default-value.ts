import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Preview Pool Test Project', '', false)
  `;
  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "isAvailableAsPreviewProject"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].isAvailableAsPreviewProject).toBe(false);
};
