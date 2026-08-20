import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const userId = randomUUID();
  const replayId = randomUUID();
  const refreshTokenId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt") VALUES (${userId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())`;
  await sql`
    INSERT INTO "SessionReplay" ("id", "tenancyId", "projectUserId", "refreshTokenId", "startedAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${replayId}::uuid, ${tenancyId}::uuid, ${userId}::uuid, ${refreshTokenId}::uuid, NOW(), NOW(), NOW(), NOW())
  `;

  return { tenancyId, replayId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const segmentId = randomUUID();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const t1 = new Date('2026-01-01T00:05:00.000Z');
  const tEarlier = new Date('2025-12-31T23:59:00.000Z');
  const tLater = new Date('2026-01-01T00:10:00.000Z');

  const upsert = (firstEventAt: Date, lastEventAt: Date) => sql`
    INSERT INTO "SessionReplaySegment" ("tenancyId", "sessionReplayId", "id", "firstEventAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${ctx.replayId}::uuid, ${segmentId}, ${firstEventAt}, ${lastEventAt}, NOW(), NOW())
    ON CONFLICT ("tenancyId", "sessionReplayId", "id") DO UPDATE SET
      "firstEventAt" = LEAST("SessionReplaySegment"."firstEventAt", EXCLUDED."firstEventAt"),
      "lastEventAt" = GREATEST("SessionReplaySegment"."lastEventAt", EXCLUDED."lastEventAt"),
      "updatedAt" = NOW()
    RETURNING "firstEventAt", "lastEventAt"
  `;

  const seeded = await upsert(t0, t1);
  expect(seeded).toHaveLength(1);
  const seededFirstMs = new Date(seeded[0].firstEventAt).getTime();
  const seededLastMs = new Date(seeded[0].lastEventAt).getTime();
  expect(seededLastMs - seededFirstMs).toBe(t1.getTime() - t0.getTime());

  const widenedLow = await upsert(tEarlier, t0);
  expect(new Date(widenedLow[0].firstEventAt).getTime()).toBe(seededFirstMs - (t0.getTime() - tEarlier.getTime()));
  expect(new Date(widenedLow[0].lastEventAt).getTime()).toBe(seededLastMs);

  const widenedHigh = await upsert(t0, tLater);
  expect(new Date(widenedHigh[0].firstEventAt).getTime()).toBe(seededFirstMs - (t0.getTime() - tEarlier.getTime()));
  expect(new Date(widenedHigh[0].lastEventAt).getTime()).toBe(seededLastMs + (tLater.getTime() - t1.getTime()));

  const contained = await upsert(t0, t1);
  expect(new Date(contained[0].firstEventAt).getTime()).toBe(seededFirstMs - (t0.getTime() - tEarlier.getTime()));
  expect(new Date(contained[0].lastEventAt).getTime()).toBe(seededLastMs + (tLater.getTime() - t1.getTime()));

  await expect(sql`
    INSERT INTO "SessionReplaySegment" ("tenancyId", "sessionReplayId", "id", "firstEventAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}, NOW(), NOW(), NOW(), NOW())
  `).rejects.toThrow(/SessionReplaySegment_tenancyId_sessionReplayId_fkey/);

  await sql`DELETE FROM "SessionReplay" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.replayId}::uuid`;
  const remaining = await sql`SELECT 1 FROM "SessionReplaySegment" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${segmentId}`;
  expect(remaining).toHaveLength(0);
};
