import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN (
        'TvDisplay',
        'TvDisplayPairingChallenge',
        'TvDisplayCredential',
        'TvDisplayPairingRateLimitBucket'
      )
  `;
  expect(tables).toHaveLength(4);

  const tenancyId = crypto.randomUUID();
  const displayId = crypto.randomUUID();
  const projectId = `tv-display-project-${crypto.randomUUID()}`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'TV Display Test', '', true)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`
    INSERT INTO "TvDisplay" (
      "id", "tenancyId", "profileId", "displayName", "pairedByAdminUserId", "updatedAt"
    ) VALUES (
      ${displayId}, ${tenancyId}, 'company-pulse', 'Lobby', ${crypto.randomUUID()}, NOW()
    )
  `;
  await sql`
    INSERT INTO "TvDisplayCredential" (
      "id", "displayId", "familyId", "tokenHash", "expiresAt"
    ) VALUES (
      ${crypto.randomUUID()}, ${displayId}, ${crypto.randomUUID()},
      ${"a".repeat(64)}, NOW() + INTERVAL '1 day'
    )
  `;
  await sql`DELETE FROM "Project" WHERE "id" = ${projectId}`;
  const displays = await sql`SELECT 1 FROM "TvDisplay" WHERE "tenancyId" = ${tenancyId}`;
  const credentials = await sql`SELECT 1 FROM "TvDisplayCredential" WHERE "displayId" = ${displayId}`;
  expect(displays).toHaveLength(0);
  expect(credentials).toHaveLength(0);

  const pairingCode = "ABC12345";
  await sql`
    INSERT INTO "TvDisplayPairingChallenge" (
      "id", "pairingCode", "deviceSecretHash", "expiresAt", "updatedAt"
    ) VALUES (
      ${crypto.randomUUID()}, ${pairingCode}, ${"b".repeat(64)}, NOW() + INTERVAL '10 minutes', NOW()
    )
  `;
  await expect(sql`
    INSERT INTO "TvDisplayPairingChallenge" (
      "id", "pairingCode", "deviceSecretHash", "expiresAt", "updatedAt"
    ) VALUES (
      ${crypto.randomUUID()}, ${pairingCode}, ${"c".repeat(64)}, NOW() + INTERVAL '10 minutes', NOW()
    )
  `).rejects.toThrow();
  await sql`DELETE FROM "TvDisplayPairingChallenge" WHERE "pairingCode" = ${pairingCode}`;
};
