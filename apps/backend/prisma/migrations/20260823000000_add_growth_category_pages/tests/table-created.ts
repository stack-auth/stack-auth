import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

// The table is new, so preMigration only has to prove the migration applies on a
// database that already holds data (a project row) without touching it.
export const preMigration = async (sql: Sql) => {
  const projectId = `growth-category-pages-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Growth category page migration test', '', false)
  `;
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'GrowthCategoryPage'
  `;
  expect(tables).toEqual([]);
  return { projectId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const { projectId } = context;

  const columns = (await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'GrowthCategoryPage'
    ORDER BY column_name
  `).map((row) => row.column_name);
  expect(columns).toEqual([
    "authoredByUserId", "branchId", "category", "createdAt", "document", "id", "isDraft",
    "isPublished", "projectId", "publishedAt", "publishedByUserId", "sourceItemIds", "sourceJson",
    "status", "updatedAt", "version",
  ]);

  const insertPage = async (options: { category?: string, version?: number, status?: string, branchId?: string }) => await sql<{ id: string, status: string, isDraft: boolean | null, isPublished: boolean | null }[]>`
    INSERT INTO "GrowthCategoryPage" ("projectId", "branchId", "category", "version", "status", "sourceJson", "document", "sourceItemIds", "publishedAt", "updatedAt")
    VALUES (
      ${projectId},
      ${options.branchId ?? "main"},
      ${options.category ?? "conversion"},
      ${options.version ?? 1},
      ${options.status ?? "draft"},
      ${sql.json({ format: "growth-mdx-v1", source_mdx: "## Hi", data: [] })},
      ${sql.json({ format: "growth-mdx-v1", sourceMdx: "## Hi", blocks: [], data: [] })},
      ${sql.json({ findings: [], actions: [] })},
      ${options.status === "published" ? new Date().toISOString() : null},
      NOW()
    )
    RETURNING "id"::text AS id, "status", "isDraft", "isPublished"
  `;

  // A page is insertable with only the columns the code supplies; status defaults to draft.
  const [draft] = await insertPage({});
  expect(draft.status).toBe("draft");
  expect(draft.isDraft).toBe(true);
  expect(draft.isPublished).toBeNull();

  // ── The draft slot ──
  // Staff cannot accumulate two half-written drafts for one stage; a retried save
  // must collide rather than fork the stage.
  await expect(insertPage({ version: 2 })).rejects.toThrow(/GrowthCategoryPage_draft_slot/);

  // ── The live slot ──
  // A published version does not conflict with the draft: the two slots are
  // independent, which is what lets staff prepare the next version while the
  // current one is live.
  const [published] = await insertPage({ version: 2, status: "published" });
  expect(published.isDraft).toBeNull();
  expect(published.isPublished).toBe(true);
  await expect(insertPage({ version: 3, status: "published" })).rejects.toThrow(/GrowthCategoryPage_published_slot/);

  // Archived versions are NULL in both slots, so the whole history coexists.
  const [archived] = await insertPage({ version: 3, status: "archived" });
  expect(archived.isDraft).toBeNull();
  expect(archived.isPublished).toBeNull();

  // Each stage, and each branch, gets its own pair of slots.
  const [otherCategory] = await insertPage({ category: "revenue", status: "published" });
  expect(otherCategory.isPublished).toBe(true);
  const [otherBranch] = await insertPage({ branchId: "other-branch", status: "published" });
  expect(otherBranch.isPublished).toBe(true);

  // Versions are unique per stage, so "what did the customer see at version N" has one answer.
  await expect(sql`
    INSERT INTO "GrowthCategoryPage" ("projectId", "branchId", "category", "version", "status", "sourceJson", "document", "sourceItemIds", "updatedAt")
    VALUES (${projectId}, 'main', 'conversion', 3, 'archived', ${sql.json({})}, ${sql.json({})}, ${sql.json({})}, NOW())
  `).rejects.toThrow(/GrowthCategoryPage_projectId_branchId_category_version_key/);

  // ── The handover ──
  // Publishing means archiving the incumbent and promoting the new version. Done in
  // the wrong order it violates the live slot, which is exactly why publishing does
  // both in one transaction.
  await expect(sql`UPDATE "GrowthCategoryPage" SET "status" = 'published', "publishedAt" = NOW() WHERE "id" = ${draft.id}::uuid`)
    .rejects.toThrow(/GrowthCategoryPage_published_slot/);
  await sql`UPDATE "GrowthCategoryPage" SET "status" = 'archived' WHERE "id" = ${published.id}::uuid`;
  const [promoted] = await sql<{ isPublished: boolean | null }[]>`
    UPDATE "GrowthCategoryPage" SET "status" = 'published', "publishedAt" = NOW() WHERE "id" = ${draft.id}::uuid
    RETURNING "isPublished"
  `;
  expect(promoted.isPublished).toBe(true);
  // ...and the draft slot is free again for the next revision.
  const [next] = await insertPage({ version: 4 });
  expect(next.isDraft).toBe(true);

  // ── Vocabularies and required attribution ──
  await expect(insertPage({ category: "not-a-stage", version: 9, status: "archived" })).rejects.toThrow(/GrowthCategoryPage_category_check/);
  await expect(insertPage({ version: 10, status: "in-review" })).rejects.toThrow(/GrowthCategoryPage_status_check/);
  await expect(insertPage({ version: 0, status: "archived" })).rejects.toThrow(/GrowthCategoryPage_version_check/);
  // A live version must record when it went live — publishing is the one staff
  // action that puts words in front of a customer.
  await expect(sql`
    INSERT INTO "GrowthCategoryPage" ("projectId", "branchId", "category", "version", "status", "sourceJson", "document", "sourceItemIds", "updatedAt")
    VALUES (${projectId}, 'main', 'retention', 1, 'published', ${sql.json({})}, ${sql.json({})}, ${sql.json({})}, NOW())
  `).rejects.toThrow(/GrowthCategoryPage_published_attribution_check/);

  // Deleting the project takes its pages with it.
  await sql`DELETE FROM "Project" WHERE "id" = ${projectId}`;
  const remaining = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM "GrowthCategoryPage" WHERE "projectId" = ${projectId}
  `;
  expect(remaining[0].count).toBe("0");
};
