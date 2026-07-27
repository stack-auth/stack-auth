import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `gtm-timeline-${randomUUID()}`;
  const insightId = randomUUID();
  const actionId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'GTM curated timeline migration test', '', false)
  `;
  await sql`
    INSERT INTO "GtmInsight" (
      "id", "projectId", "branchId", "domain", "kind", "title", "body", "updatedAt"
    )
    VALUES (
      ${insightId}::uuid, ${projectId}, 'main', 'product', 'retention',
      'Existing insight', 'Recorded before curated timelines existed', NOW()
    )
  `;
  await sql`
    INSERT INTO "GtmAction" (
      "id", "projectId", "branchId", "domain", "type", "title", "summary", "expiresAt", "updatedAt"
    )
    VALUES (
      ${actionId}::uuid, ${projectId}, 'main', 'product', 'config_change',
      'Existing action', 'Recorded before curated timelines existed', NOW() + INTERVAL '7 days', NOW()
    )
  `;

  return { projectId, insightId, actionId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  // Rows that predate the column must read back as NULL, which is what makes the dashboard keep generating
  // their timelines instead of rendering an empty curated one.
  const insights = await sql<{ timelineEntries: unknown }[]>`
    SELECT "timelineEntries" FROM "GtmInsight" WHERE "id" = ${context.insightId}::uuid
  `;
  expect(insights).toEqual([{ timelineEntries: null }]);

  const actions = await sql<{ timelineEntries: unknown }[]>`
    SELECT "timelineEntries" FROM "GtmAction" WHERE "id" = ${context.actionId}::uuid
  `;
  expect(actions).toEqual([{ timelineEntries: null }]);

  const constraints = await sql<{ conname: string, convalidated: boolean }[]>`
    SELECT "conname", "convalidated"
    FROM "pg_constraint"
    WHERE "conname" IN ('GtmInsight_timelineEntries_is_array_check', 'GtmAction_timelineEntries_is_array_check')
    ORDER BY "conname"
  `;
  expect(constraints).toEqual([
    { conname: "GtmAction_timelineEntries_is_array_check", convalidated: false },
    { conname: "GtmInsight_timelineEntries_is_array_check", convalidated: false },
  ]);

  // An ordered array of entries is the only shape the application writes.
  await sql`
    UPDATE "GtmInsight"
    SET "timelineEntries" = ${sql.json([
      { label: "Recorded", title: "A growth signal was added", body: "Curated copy.", dateMillis: 1_700_000_000_000 },
    ])}
    WHERE "id" = ${context.insightId}::uuid
  `;
  await sql`
    UPDATE "GtmAction"
    SET "timelineEntries" = ${sql.json([])}
    WHERE "id" = ${context.actionId}::uuid
  `;

  // Even NOT VALID constraints are enforced on write, so non-array JSON must be rejected on both tables.
  await expect(sql`
    UPDATE "GtmInsight"
    SET "timelineEntries" = ${sql.json({ label: "Not an array" })}
    WHERE "id" = ${context.insightId}::uuid
  `).rejects.toThrow();

  await expect(sql`
    UPDATE "GtmAction"
    SET "timelineEntries" = ${sql.json("a string")}
    WHERE "id" = ${context.actionId}::uuid
  `).rejects.toThrow();

  // Clearing a curated timeline must remain possible — that is how an admin reverts to the generated one.
  await sql`
    UPDATE "GtmInsight" SET "timelineEntries" = NULL WHERE "id" = ${context.insightId}::uuid
  `;

  await sql`DELETE FROM "Project" WHERE "id" = ${context.projectId}`;
};
