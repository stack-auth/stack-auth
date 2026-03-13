import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const sessionReplayId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt") VALUES (${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())`;
  await sql`
    INSERT INTO "SessionReplay" ("id", "tenancyId", "projectUserId", "sessionRefreshTokenId", "sessionReplaySegmentId", "startedAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${sessionReplayId}::uuid, ${tenancyId}::uuid, ${projectUserId}::uuid, 'placeholder-refresh-token', 'segment-1', NOW(), NOW(), NOW(), NOW())
  `;

  return { tenancyId, sessionReplayId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  await sql`
    INSERT INTO "ReplayIssueCluster" (
      "id",
      "tenancyId",
      "fingerprint",
      "title",
      "summary",
      "severity",
      "confidence",
      "occurrenceCount",
      "affectedUserCount",
      "firstSeenAt",
      "lastSeenAt",
      "topEvidence",
      "textEmbedding",
      "visualEmbedding",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      'frontend-error:/sign-in',
      'Frontend error surfaced during replay',
      'The replay captured a frontend error.',
      'HIGH'::"ReplayIssueSeverity",
      0.92,
      1,
      1,
      NOW(),
      NOW(),
      '[]'::jsonb,
      '{"provider":"local-hash","model":"gemini-embedding-001","dimensions":2,"generated_at_millis":1,"values":[0.1,0.9]}'::jsonb,
      NULL,
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ReplayAiSummary" (
      "id",
      "tenancyId",
      "sessionReplayId",
      "status",
      "issueFingerprint",
      "issueTitle",
      "summary",
      "whyLikely",
      "severity",
      "confidence",
      "evidence",
      "visualArtifacts",
      "relatedReplayIds",
      "providerMetadata",
      "lastAnalyzedChunkCount",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      ${ctx.sessionReplayId}::uuid,
      'READY'::"ReplayAiAnalysisStatus",
      'frontend-error:/sign-in',
      'Frontend error surfaced during replay',
      'The replay captured a frontend error.',
      'A direct browser error event was captured.',
      'HIGH'::"ReplayIssueSeverity",
      0.92,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '{}'::jsonb,
      1,
      NOW(),
      NOW()
    )
  `;

  const [summary] = await sql`
    SELECT "status"::text AS "status", "severity"::text AS "severity"
    FROM "ReplayAiSummary"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "sessionReplayId" = ${ctx.sessionReplayId}::uuid
  `;

  expect(summary).toMatchObject({
    status: "READY",
    severity: "HIGH",
  });
};
