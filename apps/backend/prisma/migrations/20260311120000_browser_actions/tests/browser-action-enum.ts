import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const enumResult = await sql<{ enumlabel: string }[]>`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = '"VerificationCodeType"'::regtype
      AND enumlabel = 'BROWSER_ACTION'
  `;
  expect(enumResult).toHaveLength(1);

  const projectId = `browser-action-migration-test-${randomUUID()}`;
  const branchId = randomUUID();
  const code = randomUUID().replaceAll("-", "");
  await sql`
    INSERT INTO "VerificationCode" (
      "projectId", "branchId", "id", "createdAt", "updatedAt", "type", "code", "expiresAt", "data", "method"
    ) VALUES (
      ${projectId}, ${branchId}, ${randomUUID()}, NOW(), NOW(), 'BROWSER_ACTION',
      ${code}, NOW() + INTERVAL '10 minutes', '{}'::jsonb, '{}'::jsonb
    )
  `;
  await sql`
    INSERT INTO "VerificationCode" (
      "projectId", "branchId", "id", "createdAt", "updatedAt", "type", "code", "expiresAt", "data", "method"
    ) VALUES (
      ${projectId}, ${branchId}, ${randomUUID()}, NOW(), NOW(), 'ONE_TIME_PASSWORD',
      ${`${code}2`}, NOW() + INTERVAL '10 minutes', '{}'::jsonb, '{}'::jsonb
    )
  `;
  await sql`DELETE FROM "VerificationCode" WHERE "projectId" = ${projectId}`;
};
