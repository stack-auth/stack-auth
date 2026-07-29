import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const serviceId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Deployment Definitions Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  // A pre-existing service row must survive the column additions and pick up
  // the new defaults.
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "framework")
    VALUES (${tenancyId}::uuid, ${serviceId}::uuid, NOW(), 'api', 'nextjs')
  `;

  return { projectId, tenancyId, serviceId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // The pre-existing row got the new columns with their defaults. In
  // particular definitionSyncedAt must be NULL: legacy rows have no synced
  // definition (their env lived in the dropped config section), and the
  // deploy route uses exactly this NULL to refuse deploying them with an
  // empty env set.
  const services = await sql<{ devCommand: string | null, env: unknown, definitionSyncedAt: Date | null }[]>`
    SELECT "devCommand", "env", "definitionSyncedAt" FROM "DeploymentService" WHERE "id" = ${ctx.serviceId}::uuid
  `;
  expect(services[0]).toEqual({ devCommand: null, env: {}, definitionSyncedAt: null });

  // The new columns are writable.
  await sql`
    UPDATE "DeploymentService"
    SET "devCommand" = 'pnpm dev', "env" = ${sql.json({ API_KEY: { type: "secret", key: "API_KEY", default_value: "dev" } })}, "definitionSyncedAt" = NOW()
    WHERE "id" = ${ctx.serviceId}::uuid
  `;
  const updated = await sql<{ devCommand: string | null, env: any }[]>`
    SELECT "devCommand", "env" FROM "DeploymentService" WHERE "id" = ${ctx.serviceId}::uuid
  `;
  expect(updated[0].devCommand).toBe("pnpm dev");
  expect(updated[0].env.API_KEY.key).toBe("API_KEY");

  // Secrets table exists and accepts rows.
  const secretId = randomUUID();
  await sql`
    INSERT INTO "DeploymentSecret" ("projectId", "id", "updatedAt", "key", "encrypted")
    VALUES (${ctx.projectId}, ${secretId}::uuid, NOW(), 'API_KEY', ${sql.json({ edkBase64: "a", ciphertextBase64: "b" })})
  `;

  // One value per (project, key).
  await expect(sql`
    INSERT INTO "DeploymentSecret" ("projectId", "id", "updatedAt", "key", "encrypted")
    VALUES (${ctx.projectId}, ${randomUUID()}::uuid, NOW(), 'API_KEY', ${sql.json({ edkBase64: "c", ciphertextBase64: "d" })})
  `).rejects.toThrow(/DeploymentSecret_projectId_key_key/);

  // The same key is allowed for a different project.
  const otherProjectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${otherProjectId}, NOW(), NOW(), 'Deployment Definitions Migration Test 2', '', false)
  `;
  await sql`
    INSERT INTO "DeploymentSecret" ("projectId", "id", "updatedAt", "key", "encrypted")
    VALUES (${otherProjectId}, ${randomUUID()}::uuid, NOW(), 'API_KEY', ${sql.json({ edkBase64: "e", ciphertextBase64: "f" })})
  `;

  // Secrets require an existing project...
  await expect(sql`
    INSERT INTO "DeploymentSecret" ("projectId", "id", "updatedAt", "key", "encrypted")
    VALUES ('nonexistent-project', ${randomUUID()}::uuid, NOW(), 'API_KEY', ${sql.json({ edkBase64: "g", ciphertextBase64: "h" })})
  `).rejects.toThrow(/DeploymentSecret_projectId_fkey/);

  // ...and cascade away with their project.
  await sql`DELETE FROM "Project" WHERE "id" = ${otherProjectId}`;
  const remaining = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM "DeploymentSecret" WHERE "projectId" = ${otherProjectId}
  `;
  expect(remaining[0].count).toBe("0");
};
