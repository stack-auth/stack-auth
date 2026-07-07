import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Agent Auth Test Project', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt"
    )
    VALUES (${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())
  `;

  return { projectId, tenancyId, projectUserId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const enumRows = await sql`
    SELECT typname
    FROM pg_type
    WHERE typname IN ('AgentHostStatus', 'AgentMode', 'AgentStatus', 'AgentCapabilityGrantStatus')
    ORDER BY typname
  `;
  expect(enumRows.map((row) => row.typname)).toEqual([
    "AgentCapabilityGrantStatus",
    "AgentHostStatus",
    "AgentMode",
    "AgentStatus",
  ]);

  const hostPublicJwk = { kty: "OKP", crv: "Ed25519", x: "host-public-key" };
  const agentPublicJwk = { kty: "OKP", crv: "Ed25519", x: "agent-public-key" };

  await sql`
    INSERT INTO "AgentHost" (
      "tenancyId",
      "id",
      "createdAt",
      "updatedAt",
      "projectUserId",
      "name",
      "publicJwk",
      "jwkThumbprint",
      "status"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      ${randomUUID()}::uuid,
      NOW(),
      NOW(),
      ${ctx.projectUserId}::uuid,
      'Host',
      ${sql.json(hostPublicJwk)},
      'host-thumbprint',
      'ACTIVE'::"AgentHostStatus"
    )
  `;

  await sql`
    INSERT INTO "Agent" (
      "tenancyId",
      "id",
      "createdAt",
      "updatedAt",
      "hostId",
      "name",
      "mode",
      "projectUserId",
      "publicJwk",
      "jwkThumbprint",
      "status",
      "expiresAt",
      "maxLifetimeEndsAt",
      "absoluteLifetimeEndsAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      ${randomUUID()}::uuid,
      NOW(),
      NOW(),
      (SELECT "id" FROM "AgentHost" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "jwkThumbprint" = 'host-thumbprint'),
      'Agent',
      'DELEGATED'::"AgentMode",
      ${ctx.projectUserId}::uuid,
      ${sql.json(agentPublicJwk)},
      'agent-thumbprint',
      'ACTIVE'::"AgentStatus",
      NOW() + INTERVAL '30 minutes',
      NOW() + INTERVAL '24 hours',
      NOW() + INTERVAL '7 days'
    )
  `;

  await sql`
    INSERT INTO "AgentCapabilityGrant" (
      "tenancyId",
      "id",
      "createdAt",
      "updatedAt",
      "agentId",
      "capability",
      "status",
      "constraints",
      "grantedByProjectUserId",
      "reason"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      ${randomUUID()}::uuid,
      NOW(),
      NOW(),
      (SELECT "id" FROM "Agent" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "jwkThumbprint" = 'agent-thumbprint'),
      'list_users',
      'ACTIVE'::"AgentCapabilityGrantStatus",
      ${sql.json({ limit: { min: 1, max: 10 } })},
      ${ctx.projectUserId}::uuid,
      'Test grant'
    )
  `;

  const countsBeforeDelete = await sql`
    SELECT
      (SELECT COUNT(*) FROM "AgentHost" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS host_count,
      (SELECT COUNT(*) FROM "Agent" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS agent_count,
      (SELECT COUNT(*) FROM "AgentCapabilityGrant" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS grant_count
  `;
  expect(countsBeforeDelete).toHaveLength(1);
  expect(Number(countsBeforeDelete[0].host_count)).toBe(1);
  expect(Number(countsBeforeDelete[0].agent_count)).toBe(1);
  expect(Number(countsBeforeDelete[0].grant_count)).toBe(1);

  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;

  const countsAfterDelete = await sql`
    SELECT
      (SELECT COUNT(*) FROM "AgentHost" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS host_count,
      (SELECT COUNT(*) FROM "Agent" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS agent_count,
      (SELECT COUNT(*) FROM "AgentCapabilityGrant" WHERE "tenancyId" = ${ctx.tenancyId}::uuid) AS grant_count
  `;
  expect(countsAfterDelete).toHaveLength(1);
  expect(Number(countsAfterDelete[0].host_count)).toBe(0);
  expect(Number(countsAfterDelete[0].agent_count)).toBe(0);
  expect(Number(countsAfterDelete[0].grant_count)).toBe(0);
};
