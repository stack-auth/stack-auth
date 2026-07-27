import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `gtm-note-title-${randomUUID()}`;
  const noteId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'GTM note title migration test', '', false)
  `;
  await sql`
    INSERT INTO "GtmNote" (
      "id",
      "projectId",
      "branchId",
      "domain",
      "category",
      "body",
      "source",
      "updatedAt"
    )
    VALUES (
      ${noteId}::uuid,
      ${projectId},
      'main',
      'product',
      'company',
      'Existing note without a title',
      'user',
      NOW()
    )
  `;

  return { projectId, noteId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const existingNotes = await sql<{ title: string | null }[]>`
    SELECT "title"
    FROM "GtmNote"
    WHERE "id" = ${context.noteId}::uuid
  `;
  expect(existingNotes).toEqual([{ title: null }]);

  const constraints = await sql<{ convalidated: boolean }[]>`
    SELECT "convalidated"
    FROM "pg_constraint"
    WHERE "conname" = 'GtmNote_title_length_check'
  `;
  expect(constraints).toEqual([{ convalidated: false }]);

  await sql`
    UPDATE "GtmNote"
    SET "title" = 'Product positioning'
    WHERE "id" = ${context.noteId}::uuid
  `;

  await expect(sql`
    UPDATE "GtmNote"
    SET "title" = ''
    WHERE "id" = ${context.noteId}::uuid
  `).rejects.toThrow();

  await expect(sql`
    UPDATE "GtmNote"
    SET "title" = ${"x".repeat(121)}
    WHERE "id" = ${context.noteId}::uuid
  `).rejects.toThrow();

  await sql`
    UPDATE "GtmNote"
    SET "title" = NULL
    WHERE "id" = ${context.noteId}::uuid
  `;

  await sql`
    DELETE FROM "Project"
    WHERE "id" = ${context.projectId}
  `;
};
