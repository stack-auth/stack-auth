import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Agent Auth Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { tenancyId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const enums = await sql<{ type_name: string, enum_label: string }[]>`
    SELECT t.typname AS type_name, e.enumlabel AS enum_label
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('AgentAuthRegistrationType', 'AgentAuthRegistrationStatus')
    ORDER BY t.typname, e.enumsortorder
  `;
  expect(Array.from(enums)).toMatchInlineSnapshot(`
    [
      {
        "enum_label": "pending",
        "type_name": "AgentAuthRegistrationStatus",
      },
      {
        "enum_label": "claimed",
        "type_name": "AgentAuthRegistrationStatus",
      },
      {
        "enum_label": "expired",
        "type_name": "AgentAuthRegistrationStatus",
      },
      {
        "enum_label": "anonymous",
        "type_name": "AgentAuthRegistrationType",
      },
      {
        "enum_label": "service_auth",
        "type_name": "AgentAuthRegistrationType",
      },
    ]
  `);

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'AgentAuthRegistration'
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "AgentAuthRegistration",
      },
    ]
  `);

  const claimToken = `claim-token-${randomUUID()}`;
  const claimAttemptToken = `claim-attempt-${randomUUID()}`;
  const userCode = "123456";

  await sql`
    INSERT INTO "AgentAuthRegistration" (
      "tenancyId",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'service_auth',
      'pending',
      'agent@example.com',
      ${claimToken},
      ${claimAttemptToken},
      ${userCode},
      NOW() + INTERVAL '10 minutes',
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "AgentAuthRegistration" (
      "tenancyId",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'anonymous',
      'pending',
      NULL,
      ${`claim-token-null-${randomUUID()}`},
      NULL,
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `;

  const rows = await sql`
    SELECT "status", "loginHint", "claimAttemptToken", "userCode"
    FROM "AgentAuthRegistration"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "claimToken" = ${claimToken}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("pending");
  expect(rows[0].loginHint).toBe("agent@example.com");
  expect(rows[0].claimAttemptToken).toBe(claimAttemptToken);
  expect(rows[0].userCode).toBe(userCode);

  await expect(sql`
    INSERT INTO "AgentAuthRegistration" (
      "tenancyId",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'anonymous',
      'pending',
      NULL,
      ${claimToken},
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/AgentAuthRegistration_claimToken_key/);

  await expect(sql`
    INSERT INTO "AgentAuthRegistration" (
      "tenancyId",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId}::uuid,
      'service_auth',
      'pending',
      NULL,
      ${`claim-token-second-${randomUUID()}`},
      ${claimAttemptToken},
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/AgentAuthRegistration_claimAttemptToken_key/);
};
