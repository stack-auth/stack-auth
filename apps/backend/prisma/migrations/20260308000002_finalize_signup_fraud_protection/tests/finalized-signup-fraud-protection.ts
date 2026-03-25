import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const userId = randomUUID();
  const explicitSignedUpAt = '2026-03-08 12:34:56.789';

  const triggers = await sql`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = '"ProjectUser"'::regclass
      AND tgname = 'ProjectUser_set_signedUpAt_from_createdAt'
      AND NOT tgisinternal
  `;
  expect(triggers).toHaveLength(0);

  const functions = await sql`
    SELECT proname
    FROM pg_proc
    WHERE proname = 'set_project_user_signed_up_at_from_created_at'
  `;
  expect(functions).toHaveLength(0);

  const constraints = await sql`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid = '"ProjectUser"'::regclass
      AND conname IN (
        'ProjectUser_risk_score_bot_range',
        'ProjectUser_risk_score_free_trial_abuse_range',
        'ProjectUser_signedUpAt_not_null'
      )
    ORDER BY conname
  `;
  expect(constraints).toHaveLength(3);
  for (const constraint of constraints) {
    expect(constraint.convalidated, `${constraint.conname} should be validated`).toBe(true);
  }

  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'ProjectUser'
      AND indexname IN (
        'ProjectUser_signedUpAt_asc',
        'ProjectUser_signUpIp_recent_idx',
        'ProjectUser_signUpEmailBase_recent_idx'
      )
    ORDER BY indexname
  `;
  expect(indexes.map((row) => row.indexname)).toEqual([
    'ProjectUser_signUpEmailBase_recent_idx',
    'ProjectUser_signUpIp_recent_idx',
    'ProjectUser_signedUpAt_asc',
  ]);

  const indexDefByName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
  expect(indexDefByName['ProjectUser_signedUpAt_asc']).toContain('"tenancyId", "isAnonymous", "signedUpAt"');
  expect(indexDefByName['ProjectUser_signUpIp_recent_idx']).toContain('"tenancyId", "isAnonymous", "signUpIp", "signedUpAt"');
  expect(indexDefByName['ProjectUser_signUpEmailBase_recent_idx']).toContain('"tenancyId", "isAnonymous", "signUpEmailBase", "signedUpAt"');

  const colInfo = await sql`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'ProjectUser'
      AND column_name = 'signedUpAt'
  `;
  expect(colInfo).toHaveLength(1);
  expect(colInfo[0].is_nullable).toBe('NO');
  expect(colInfo[0].column_default).toBe('CURRENT_TIMESTAMP');

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  // INSERT without signedUpAt should succeed — DEFAULT CURRENT_TIMESTAMP fills it in.
  const defaultUserId = randomUUID();
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt"
    ) VALUES (
      ${defaultUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW()
    )
  `;

  const defaultRows = await sql`
    SELECT "signedUpAt"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${defaultUserId}::uuid
  `;
  expect(defaultRows).toHaveLength(1);
  expect(defaultRows[0].signedUpAt).not.toBeNull();

  // INSERT with explicit signedUpAt should use the provided value.
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "signedUpAt"
    ) VALUES (
      ${userId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      ${explicitSignedUpAt}::timestamp
    )
  `;

  const insertedRows = await sql`
    SELECT
      "signedUpAt",
      "createdAt",
      "signedUpAt" = ${explicitSignedUpAt}::timestamp AS "matchesExplicitSignedUpAt"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${userId}::uuid
  `;
  expect(insertedRows).toHaveLength(1);
  expect(insertedRows[0].signedUpAt).not.toBeNull();
  expect(insertedRows[0].matchesExplicitSignedUpAt).toBe(true);
  expect(insertedRows[0].signedUpAt.toISOString()).not.toBe(insertedRows[0].createdAt.toISOString());
};
