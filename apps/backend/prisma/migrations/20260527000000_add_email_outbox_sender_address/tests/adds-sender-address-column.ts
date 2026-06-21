import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const outboxId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Email Sender Address Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  // An email queued before the migration must keep working (senderAddressId NULL).
  await sql`
    INSERT INTO "EmailOutbox" (
      "id",
      "tenancyId",
      "createdAt",
      "updatedAt",
      "tsxSource",
      "isHighPriority",
      "to",
      "extraRenderVariables",
      "shouldSkipDeliverabilityCheck",
      "createdWith",
      "scheduledAt"
    )
    VALUES (
      ${outboxId}::uuid,
      ${tenancyId}::uuid,
      NOW(),
      NOW(),
      'export default function Email() { return null; }',
      false,
      ${JSON.stringify({ type: "custom-emails", emails: ["legacy@example.com"] })}::jsonb,
      '{}'::jsonb,
      false,
      'PROGRAMMATIC_CALL'::"EmailOutboxCreatedWith",
      NOW()
    )
  `;

  return { tenancyId, outboxId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // The column exists, is nullable, and is text.
  const columns = await sql<{ column_name: string, is_nullable: string, data_type: string }[]>`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailOutbox'
      AND column_name = 'senderAddressId'
  `;
  expect(Array.from(columns)).toMatchInlineSnapshot(`
    [
      {
        "column_name": "senderAddressId",
        "data_type": "text",
        "is_nullable": "YES",
      },
    ]
  `);

  // The pre-existing row defaults to NULL.
  const legacyRows = await sql`
    SELECT "senderAddressId"
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.outboxId}::uuid
  `;
  expect(legacyRows).toHaveLength(1);
  expect(legacyRows[0].senderAddressId).toBeNull();

  // New rows can carry a sender address id.
  const newOutboxId = randomUUID();
  await sql`
    INSERT INTO "EmailOutbox" (
      "id",
      "tenancyId",
      "createdAt",
      "updatedAt",
      "tsxSource",
      "isHighPriority",
      "to",
      "extraRenderVariables",
      "shouldSkipDeliverabilityCheck",
      "createdWith",
      "scheduledAt",
      "senderAddressId"
    )
    VALUES (
      ${newOutboxId}::uuid,
      ${ctx.tenancyId}::uuid,
      NOW(),
      NOW(),
      'export default function Email() { return null; }',
      false,
      ${JSON.stringify({ type: "custom-emails", emails: ["support@example.com"] })}::jsonb,
      '{}'::jsonb,
      false,
      'PROGRAMMATIC_CALL'::"EmailOutboxCreatedWith",
      NOW(),
      'support-address'
    )
  `;

  const newRows = await sql`
    SELECT "senderAddressId"
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${newOutboxId}::uuid
  `;
  expect(newRows).toHaveLength(1);
  expect(newRows[0].senderAddressId).toBe("support-address");
};
