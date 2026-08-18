import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `gtm-migration-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'GTM migration test', '', false)
  `;
  return { projectId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('GtmInsight', 'GtmAction', 'GtmNote', 'GtmOnboarding')
    ORDER BY table_name
  `;
  expect(Array.from(tables).map((row) => row.table_name)).toEqual([
    "GtmAction",
    "GtmInsight",
    "GtmNote",
    "GtmOnboarding",
  ]);

  const insightId = randomUUID();
  const actionId = randomUUID();
  const noteId = randomUUID();
  await sql`
    INSERT INTO "GtmInsight" ("id", "projectId", "branchId", "updatedAt", "domain", "kind", "title", "body")
    VALUES (${insightId}::uuid, ${context.projectId}, 'main', NOW(), 'users', 'retention', 'Retention signal', 'Users are returning more often.')
  `;
  await sql`
    INSERT INTO "GtmAction" ("id", "projectId", "branchId", "updatedAt", "domain", "type", "title", "summary", "expiresAt")
    VALUES (${actionId}::uuid, ${context.projectId}, 'main', NOW(), 'outreach', 'broadcast_email', 'Invite active users', 'Send a focused update.', NOW() + INTERVAL '14 days')
  `;
  await sql`
    INSERT INTO "GtmNote" ("id", "projectId", "branchId", "updatedAt", "domain", "category", "body")
    VALUES (${noteId}::uuid, ${context.projectId}, 'main', NOW(), 'content', 'audience', 'Developers value fast setup.')
  `;

  const insightDefaults = await sql<{ domain: string, status: string, confidence: string, impactScore: number, timesSeen: number }[]>`
    SELECT "domain", "status", "confidence", "impactScore", "timesSeen"
    FROM "GtmInsight"
    WHERE "id" = ${insightId}::uuid
  `;
  expect(insightDefaults[0]).toEqual({
    domain: "users",
    status: "new",
    confidence: "medium",
    impactScore: 0,
    timesSeen: 1,
  });

  const actionDefaults = await sql<{ domain: string, status: string, verdict: string | null, executedAt: Date | null }[]>`
    SELECT "domain", "status", "verdict", "executedAt"
    FROM "GtmAction"
    WHERE "id" = ${actionId}::uuid
  `;
  expect(actionDefaults[0]).toEqual({ domain: "outreach", status: "proposed", verdict: null, executedAt: null });

  const noteDefaults = await sql<{ domain: string, source: string }[]>`
    SELECT "domain", "source"
    FROM "GtmNote"
    WHERE "id" = ${noteId}::uuid
  `;
  expect(noteDefaults[0]).toEqual({ domain: "content", source: "user" });

  await sql`
    INSERT INTO "GtmOnboarding" ("projectId", "branchId", "domain", "phone", "updatedAt")
    VALUES (${context.projectId}, 'main', NULL, '+1 415 555 0100', NOW())
  `;
  const onboarding = await sql<{ domain: string | null, notes: string, completedAt: Date }[]>`
    SELECT "domain", "notes", "completedAt"
    FROM "GtmOnboarding"
    WHERE "projectId" = ${context.projectId} AND "branchId" = 'main'
  `;
  expect(onboarding[0]).toEqual({
    domain: null,
    notes: "",
    completedAt: expect.any(Date),
  });

  const recentIndexes = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'GtmInsight_projectId_branchId_createdAt_id_idx',
        'GtmAction_projectId_branchId_createdAt_id_idx',
        'GtmNote_projectId_branchId_createdAt_id_idx'
      )
    ORDER BY indexname
  `;
  expect(Array.from(recentIndexes).map((row) => row.indexname)).toEqual([
    "GtmAction_projectId_branchId_createdAt_id_idx",
    "GtmInsight_projectId_branchId_createdAt_id_idx",
    "GtmNote_projectId_branchId_createdAt_id_idx",
  ]);

  const cascadeForeignKeys = await sql<{ constraint_name: string, delete_rule: string }[]>`
    SELECT constraint_name, delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name IN (
        'GtmInsight_projectId_fkey',
        'GtmAction_projectId_fkey',
        'GtmNote_projectId_fkey',
        'GtmOnboarding_projectId_fkey'
      )
    ORDER BY constraint_name
  `;
  expect(Array.from(cascadeForeignKeys)).toEqual([
    { constraint_name: "GtmAction_projectId_fkey", delete_rule: "CASCADE" },
    { constraint_name: "GtmInsight_projectId_fkey", delete_rule: "CASCADE" },
    { constraint_name: "GtmNote_projectId_fkey", delete_rule: "CASCADE" },
    { constraint_name: "GtmOnboarding_projectId_fkey", delete_rule: "CASCADE" },
  ]);

  await expect(sql`
    INSERT INTO "GtmInsight" ("projectId", "branchId", "updatedAt", "domain", "kind", "title", "body", "impactScore")
    VALUES (${context.projectId}, 'main', NOW(), 'users', 'retention', 'Invalid score', 'Invalid score', 101)
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmAction" ("projectId", "branchId", "updatedAt", "domain", "type", "status", "title", "summary", "expiresAt")
    VALUES (${context.projectId}, 'main', NOW(), 'outreach', 'broadcast_email', 'sent-without-review', 'Invalid status', 'Invalid status', NOW())
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmNote" ("projectId", "branchId", "updatedAt", "domain", "category", "body")
    VALUES (${context.projectId}, 'main', NOW(), 'users', 'audience', '')
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmNote" ("projectId", "branchId", "updatedAt", "domain", "category", "body")
    VALUES ('missing-project', 'main', NOW(), 'users', 'audience', 'The foreign key must reject this row.')
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmNote" ("projectId", "branchId", "updatedAt", "domain", "category", "body")
    VALUES (${context.projectId}, 'main', NOW(), 'made-up', 'audience', 'Invalid domain')
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmOnboarding" ("projectId", "branchId", "domain", "phone", "updatedAt")
    VALUES (${context.projectId}, 'main', 'duplicate.example.com', '+1 415 555 0101', NOW())
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmOnboarding" ("projectId", "branchId", "domain", "phone", "updatedAt")
    VALUES (${context.projectId}, 'invalid-domain', ${"x".repeat(254)}, '+1 415 555 0102', NOW())
  `).rejects.toThrow();
  await expect(sql`
    INSERT INTO "GtmOnboarding" ("projectId", "branchId", "domain", "phone", "updatedAt")
    VALUES (${context.projectId}, 'empty-domain', '', '+1 415 555 0103', NOW())
  `).rejects.toThrow(/GtmOnboarding_domain_length_check/);
  await expect(sql`
    INSERT INTO "GtmOnboarding" ("projectId", "branchId", "domain", "phone", "updatedAt")
    VALUES (${context.projectId}, 'invalid-phone', 'example.com', '123', NOW())
  `).rejects.toThrow(/GtmOnboarding_phone_length_check/);

  await sql`DELETE FROM "Project" WHERE "id" = ${context.projectId}`;
  const remaining = await sql<{ count: number }[]>`
    SELECT (
      (SELECT count(*) FROM "GtmInsight" WHERE "projectId" = ${context.projectId}) +
      (SELECT count(*) FROM "GtmAction" WHERE "projectId" = ${context.projectId}) +
      (SELECT count(*) FROM "GtmNote" WHERE "projectId" = ${context.projectId}) +
      (SELECT count(*) FROM "GtmOnboarding" WHERE "projectId" = ${context.projectId})
    )::int AS count
  `;
  expect(remaining[0].count).toBe(0);
};
