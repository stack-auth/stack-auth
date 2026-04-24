import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

/**
 * Migration-level test for `20260420000000_add_oidc_federation_audit`.
 *
 * Verifies that:
 *   - `OidcFederationExchangeAudit` exists with the expected columns + types,
 *   - `createdAt` defaults to now and is non-nullable,
 *   - the lookup index on (tenancyId, policyId, createdAt DESC) exists,
 *   - inserts + a per-tenancy-per-policy MAX(createdAt) aggregate work (this is the
 *     query shape the dashboard will use to show "last used at" per policy).
 */
export const postMigration = async (sql: Sql) => {
  // 1. Column shape.
  const columnRows = await sql<Array<{ column_name: string, is_nullable: string, data_type: string }>>`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OidcFederationExchangeAudit'
    ORDER BY ordinal_position
  `;
  // Columns are validated as a set — Prisma may reorder ordinals when fields are reshuffled,
  // and the set is what the application actually depends on.
  expect(columnRows.map(r => r.column_name).sort()).toEqual([
    "createdAt",
    "id",
    "issuer",
    "outcome",
    "policyId",
    "reason",
    "subject",
    "tenancyId",
  ]);
  for (const row of columnRows) {
    expect(row.is_nullable).toBe("NO");
  }
  const byName = Object.fromEntries(columnRows.map(r => [r.column_name, r]));
  expect(byName["id"].data_type).toBe("uuid");
  expect(byName["tenancyId"].data_type).toBe("uuid");
  expect(byName["createdAt"].data_type).toBe("timestamp without time zone");

  // 2. Index exists with the expected column list + ordering.
  const indexRows = await sql<Array<{ indexdef: string }>>`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'OidcFederationExchangeAudit'
      AND indexname = 'OidcFederationExchangeAudit_tenancy_policy_createdAt_idx'
  `;
  expect(indexRows).toHaveLength(1);
  expect(indexRows[0].indexdef).toContain('"tenancyId"');
  expect(indexRows[0].indexdef).toContain('"policyId"');
  expect(indexRows[0].indexdef).toContain('"createdAt" DESC');

  // 3. Insert + aggregate — the dashboard "last used at" query shape.
  // The audit table FKs to Tenancy, which itself FKs to Project, so create both first.
  const projectId = `test-${randomUUID()}`;
  const otherProjectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const otherTenancyId = randomUUID();
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${otherProjectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${otherTenancyId}::uuid, NOW(), NOW(), ${otherProjectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql.unsafe(`
    INSERT INTO "OidcFederationExchangeAudit" ("id", "tenancyId", "policyId", "issuer", "subject", "outcome", "reason", "createdAt")
    VALUES
      (gen_random_uuid(), '${tenancyId}', 'policy-a', 'https://idp', 'sub-1', 'success', '', '2026-01-01 00:00:00'),
      (gen_random_uuid(), '${tenancyId}', 'policy-a', 'https://idp', 'sub-2', 'success', '', '2026-01-02 00:00:00'),
      (gen_random_uuid(), '${tenancyId}', 'policy-b', '',            '',      'failure', 'nope', '2026-01-03 00:00:00'),
      (gen_random_uuid(), '${otherTenancyId}', 'policy-a', 'https://idp', 'sub-3', 'success', '', '2026-01-05 00:00:00');
  `);

  const aggregate = await sql<Array<{ policyId: string, lastAt: Date, total: bigint }>>`
    SELECT "policyId", MAX("createdAt") AS "lastAt", COUNT(*)::bigint AS total
    FROM "OidcFederationExchangeAudit"
    WHERE "tenancyId" = ${tenancyId}
    GROUP BY "policyId"
    ORDER BY "policyId"
  `;
  expect(aggregate).toHaveLength(2);
  expect(aggregate[0].policyId).toBe("policy-a");
  expect(Number(aggregate[0].total)).toBe(2);
  expect(aggregate[0].lastAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  expect(aggregate[1].policyId).toBe("policy-b");
  expect(Number(aggregate[1].total)).toBe(1);

  // Clean up so later tests see an empty table.
  await sql`DELETE FROM "OidcFederationExchangeAudit"`;
};
