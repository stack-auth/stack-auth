import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `gtm-tags-${randomUUID()}`;
  const insightId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'GTM tag migration test', '', false)
  `;
  await sql`
    INSERT INTO "GtmInsight" ("id", "projectId", "branchId", "updatedAt", "domain", "kind", "status", "confidence", "title", "body")
    VALUES (${insightId}::uuid, ${projectId}, 'main', NOW(), 'users', 'retention', 'new', 'high', 'Retention signal', 'Users are returning more often.')
  `;
  return { projectId, insightId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const removedColumns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'GtmInsight'
      AND column_name IN ('kind', 'status', 'confidence')
  `;
  expect(removedColumns).toEqual([]);

  const retainedInsight = await sql<{ id: string, title: string }[]>`
    SELECT "id"::text AS id, "title"
    FROM "GtmInsight"
    WHERE "id" = ${context.insightId}::uuid
  `;
  expect(retainedInsight).toEqual([{ id: context.insightId, title: "Retention signal" }]);

  await sql`DELETE FROM "Project" WHERE "id" = ${context.projectId}`;
};
