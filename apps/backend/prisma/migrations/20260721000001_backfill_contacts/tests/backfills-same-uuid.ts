import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Contact Backfill Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt",
      "displayName", "profileImageUrl", "clientMetadata", "serverMetadata",
      "temp_contact_backfilled"
    )
    VALUES (
      ${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(),
      'Grace Hopper', 'https://example.com/g.png', '{"a":1}'::jsonb, '{"b":2}'::jsonb,
      false
    )
  `;
  // The compatibility trigger protects writes that happen after the expand
  // migration. Remove its result to model a row that predates that migration.
  await sql`
    DELETE FROM "Contact"
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "id" = ${projectUserId}::uuid
  `;
  await sql`
    UPDATE "ProjectUser"
    SET "temp_contact_backfilled" = false
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "projectUserId" = ${projectUserId}::uuid
  `;

  return { tenancyId, projectUserId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const contactRows = await sql<{
    id: string,
    displayName: string | null,
    profileImageUrl: string | null,
    clientMetadata: unknown,
    serverMetadata: unknown,
  }[]>`
    SELECT "id", "displayName", "profileImageUrl", "clientMetadata", "serverMetadata"
    FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.projectUserId}::uuid
  `;
  expect(contactRows).toHaveLength(1);
  expect(contactRows[0].id).toBe(ctx.projectUserId);
  expect(contactRows[0].displayName).toBe("Grace Hopper");
  expect(contactRows[0].profileImageUrl).toBe("https://example.com/g.png");
  expect(contactRows[0].clientMetadata).toEqual({ a: 1 });
  expect(contactRows[0].serverMetadata).toEqual({ b: 2 });

  const flagged = await sql<{ temp_contact_backfilled: boolean }[]>`
    SELECT "temp_contact_backfilled"
    FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  expect(flagged).toHaveLength(1);
  expect(flagged[0].temp_contact_backfilled).toBe(true);
};
