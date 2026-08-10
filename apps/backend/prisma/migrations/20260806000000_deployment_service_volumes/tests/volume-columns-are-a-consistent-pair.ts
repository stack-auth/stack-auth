import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

// The migration adds volumePath/volumeSizeGb plus the constraints that keep them
// a consistent pair. What matters is that (a) rows that predate volumes survive
// untouched and read as "no volume", and (b) a half-written or out-of-range pair
// is refused by the database, not silently reinterpreted as "detach the disk".

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Volume columns migration test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  // A service that exists before volumes do — the state of every row in prod.
  const existingServiceId = randomUUID();
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "ports")
    VALUES (${tenancyId}::uuid, ${existingServiceId}::uuid, NOW(), 'pre-existing-service', '[{"port": 3000, "public": false, "transport": "http"}]'::text::jsonb)
  `;
  return { tenancyId, existingServiceId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  // 1. The pre-existing row survives and reads as "no volume".
  const [existing] = await sql<{ volumePath: string | null, volumeSizeGb: number | null }[]>`
    SELECT "volumePath", "volumeSizeGb" FROM "DeploymentService" WHERE "id" = ${context.existingServiceId}::uuid
  `;
  expect(existing).toEqual({ volumePath: null, volumeSizeGb: null });

  const insertService = async (serviceId: string, volumePath: string | null, volumeSizeGb: number | null) => {
    await sql`
      INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "ports", "volumePath", "volumeSizeGb")
      VALUES (${context.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${serviceId}, '[{"port": 3000, "public": false, "transport": "http"}]'::text::jsonb, ${volumePath}, ${volumeSizeGb})
    `;
  };

  // 2. Both halves set, and neither half set, are the two legal shapes.
  await insertService("with-volume", "/data", 10);
  await insertService("without-volume", null, null);

  // 3. Either half alone is refused — this is the case that would otherwise be
  //    silently read as "no volume" and detach a live disk on the next deploy.
  await expect(insertService("path-only", "/data", null)).rejects.toThrow(/volume_pair_check/);
  await expect(insertService("size-only", null, 10)).rejects.toThrow(/volume_pair_check/);

  // 4. Sizes outside Fly's supported range are refused.
  await expect(insertService("too-small", "/data", 0)).rejects.toThrow(/volumeSizeGb_range_check/);
  await expect(insertService("too-big", "/data", 501)).rejects.toThrow(/volumeSizeGb_range_check/);
  await insertService("min-size", "/data", 1);
  await insertService("max-size", "/data", 500);
};
