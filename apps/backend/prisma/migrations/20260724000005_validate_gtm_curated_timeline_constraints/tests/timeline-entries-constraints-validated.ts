import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `gtm-timeline-validate-${randomUUID()}`;
  const insightId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'GTM curated timeline validation test', '', false)
  `;
  await sql`
    INSERT INTO "GtmInsight" (
      "id", "projectId", "branchId", "domain", "kind", "title", "body", "updatedAt", "timelineEntries"
    )
    VALUES (
      ${insightId}::uuid, ${projectId}, 'main', 'product', 'retention',
      'Curated insight', 'Has a curated timeline before validation runs', NOW(),
      ${sql.json([{ label: "Recorded", title: "A growth signal was added", body: "Curated copy.", dateMillis: 1_700_000_000_000 }])}
    )
  `;

  // The constraints are still NOT VALID at this point, so a pre-existing array row is what validation has to scan.
  const before = await sql<{ convalidated: boolean }[]>`
    SELECT "convalidated" FROM "pg_constraint"
    WHERE "conname" = 'GtmInsight_timelineEntries_is_array_check'
  `;
  expect(before).toEqual([{ convalidated: false }]);

  return { projectId, insightId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const constraints = await sql<{ conname: string, convalidated: boolean }[]>`
    SELECT "conname", "convalidated"
    FROM "pg_constraint"
    WHERE "conname" IN ('GtmInsight_timelineEntries_is_array_check', 'GtmAction_timelineEntries_is_array_check')
    ORDER BY "conname"
  `;
  expect(constraints).toEqual([
    { conname: "GtmAction_timelineEntries_is_array_check", convalidated: true },
    { conname: "GtmInsight_timelineEntries_is_array_check", convalidated: true },
  ]);

  // Validation must not have disturbed the curated data it scanned.
  const insights = await sql<{ timelineEntries: { label: string }[] }[]>`
    SELECT "timelineEntries" FROM "GtmInsight" WHERE "id" = ${context.insightId}::uuid
  `;
  expect(insights[0].timelineEntries).toHaveLength(1);
  expect(insights[0].timelineEntries[0].label).toBe("Recorded");

  await expect(sql`
    UPDATE "GtmInsight"
    SET "timelineEntries" = ${sql.json({ not: "an array" })}
    WHERE "id" = ${context.insightId}::uuid
  `).rejects.toThrow();

  await sql`DELETE FROM "Project" WHERE "id" = ${context.projectId}`;
};
