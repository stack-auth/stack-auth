import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `growth-presentations-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Growth presentations test', '', false)
  `;
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO "GrowthAnalysisRun" ("projectId", "branchId", "trigger", "status", "updatedAt")
    VALUES (${projectId}, 'main', 'initial', 'COMPLETED', NOW())
    RETURNING "id"::text AS id
  `;
  const [report] = await sql<{ id: string }[]>`
    INSERT INTO "GrowthReport" ("runId", "projectId", "branchId", "title", "summary", "contentMd")
    VALUES (${run.id}::uuid, ${projectId}, 'main', 'Presentation test report', 'Summary', '# Report')
    RETURNING "id"::text AS id
  `;
  return { projectId, reportId: report.id, runId: run.id };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  const [first] = await sql<{ id: string }[]>`
    INSERT INTO "GrowthReportPresentation"
      ("reportId", "projectId", "branchId", "format", "tsxSource", "actionItemIds", "version")
    VALUES
      (${context.reportId}::uuid, ${context.projectId}, 'main', 'sandboxed-tsx-v1',
       'const Dashboard = () => null;', ARRAY[]::text[], 1)
    RETURNING "id"::text AS id
  `;

  await expect(sql`
    INSERT INTO "GrowthReportPresentation"
      ("reportId", "projectId", "branchId", "format", "tsxSource", "actionItemIds", "version")
    VALUES
      (${context.reportId}::uuid, ${context.projectId}, 'main', 'sandboxed-tsx-v1',
       'const Dashboard = () => null;', ARRAY[]::text[], 1)
  `).rejects.toThrow(/GrowthReportPresentation_reportId_version_key/);

  await sql`
    UPDATE "GrowthReportPresentation"
    SET "publishedAt" = NOW()
    WHERE "id" = ${first.id}::uuid
  `;
  await expect(sql`
    INSERT INTO "GrowthReportPresentation"
      ("reportId", "projectId", "branchId", "format", "tsxSource", "actionItemIds", "version", "publishedAt")
    VALUES
      (${context.reportId}::uuid, ${context.projectId}, 'main', 'sandboxed-tsx-v1',
       'const Dashboard = () => null;', ARRAY[]::text[], 2, NOW())
  `).rejects.toThrow(/GrowthReportPresentation_one_published_per_report_key/);

  await sql`
    INSERT INTO "GrowthReportPresentation"
      ("reportId", "projectId", "branchId", "format", "tsxSource", "actionItemIds", "version")
    VALUES
      (${context.reportId}::uuid, ${context.projectId}, 'main', 'sandboxed-tsx-v1',
       'const Dashboard = () => null;', ARRAY[]::text[], 2)
  `;

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${`${context.projectId}-other`}, NOW(), NOW(), 'Other growth presentations test', '', false)
  `;
  const [foreignReport] = await sql<{ id: string }[]>`
    INSERT INTO "GrowthAnalysisRun" ("projectId", "branchId", "trigger", "status", "updatedAt")
    VALUES (${`${context.projectId}-other`}, 'main', 'initial', 'COMPLETED', NOW())
    RETURNING "id"::text AS id
  `;
  const [foreignReportRow] = await sql<{ id: string }[]>`
    INSERT INTO "GrowthReport" ("runId", "projectId", "branchId", "title", "summary", "contentMd")
    VALUES (${foreignReport.id}::uuid, ${`${context.projectId}-other`}, 'main', 'Other report', 'Summary', '# Other')
    RETURNING "id"::text AS id
  `;
  await sql`
    INSERT INTO "GrowthReportPresentation"
      ("reportId", "projectId", "branchId", "format", "tsxSource", "actionItemIds", "version")
    VALUES
      (${foreignReportRow.id}::uuid, ${`${context.projectId}-other`}, 'main', 'sandboxed-tsx-v1',
       'const Dashboard = () => null;', ARRAY[]::text[], 1)
  `;
  const nullableMetadata = await sql`
    SELECT "publishedAt", "publishedByUserId"
    FROM "GrowthReportPresentation"
    WHERE "reportId" = ${foreignReportRow.id}::uuid
  `;
  expect(nullableMetadata).toEqual([{ publishedAt: null, publishedByUserId: null }]);

  await sql`DELETE FROM "GrowthReport" WHERE "id" = ${context.reportId}::uuid`;
  const remaining = await sql`
    SELECT 1 FROM "GrowthReportPresentation" WHERE "reportId" = ${context.reportId}::uuid
  `;
  expect(remaining).toEqual([]);

  await sql`DELETE FROM "GrowthReport" WHERE "id" = ${foreignReportRow.id}::uuid`;
  await sql`DELETE FROM "GrowthAnalysisRun" WHERE "id" = ${foreignReport.id}::uuid`;
  await sql`DELETE FROM "GrowthAnalysisRun" WHERE "id" = ${context.runId}::uuid`;
  await sql`DELETE FROM "Project" WHERE "id" IN (${context.projectId}, ${`${context.projectId}-other`})`;
};
