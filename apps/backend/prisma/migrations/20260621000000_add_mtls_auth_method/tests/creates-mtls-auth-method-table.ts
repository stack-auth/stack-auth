import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  // One AuthMethod row per certificate we intend to register (mTLS supports multiple certs per user,
  // and each certificate is backed by its own AuthMethod).
  const authMethodId1 = randomUUID();
  const authMethodId2 = randomUUID();
  const authMethodId3 = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'mTLS Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt")
    VALUES (${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())
  `;
  for (const authMethodId of [authMethodId1, authMethodId2, authMethodId3]) {
    await sql`
      INSERT INTO "AuthMethod" ("id", "tenancyId", "projectUserId", "createdAt", "updatedAt")
      VALUES (${authMethodId}::uuid, ${tenancyId}::uuid, ${projectUserId}::uuid, NOW(), NOW())
    `;
  }

  return { tenancyId, projectUserId, authMethodId1, authMethodId2, authMethodId3 };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'MtlsAuthMethod'
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "MtlsAuthMethod",
      },
    ]
  `);

  // The new enum values exist.
  const enumValues = await sql<{ enumlabel: string }[]>`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'VerificationCodeType'
      AND e.enumlabel IN ('MTLS_REGISTRATION_CHALLENGE', 'MTLS_AUTHENTICATION_CHALLENGE')
    ORDER BY e.enumlabel
  `;
  expect(Array.from(enumValues)).toMatchInlineSnapshot(`
    [
      {
        "enumlabel": "MTLS_AUTHENTICATION_CHALLENGE",
      },
      {
        "enumlabel": "MTLS_REGISTRATION_CHALLENGE",
      },
    ]
  `);

  const fingerprintA = "aa".repeat(32);
  const fingerprintB = "bb".repeat(32);

  // Register a first certificate and read it back.
  await sql`
    INSERT INTO "MtlsAuthMethod" (
      "tenancyId", "authMethodId", "projectUserId", "createdAt", "updatedAt",
      "fingerprint", "publicKey", "certificatePem", "subject", "issuer",
      "serialNumber", "keyAlgorithm", "signatureAlgorithm", "validFrom", "validTo", "displayName"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.authMethodId1}::uuid, ${ctx.projectUserId}::uuid, NOW(), NOW(),
      ${fingerprintA}, 'pub-a', '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
      'CN=Alice', 'CN=Alice', '01', 'EC', 'ecdsa-with-SHA256', NOW(), NOW() + INTERVAL '365 days', 'Laptop'
    )
  `;
  const insertedCert = await sql`
    SELECT "fingerprint", "keyAlgorithm", "displayName"
    FROM "MtlsAuthMethod"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "authMethodId" = ${ctx.authMethodId1}::uuid
  `;
  expect(Array.from(insertedCert)).toMatchInlineSnapshot(`
    [
      {
        "displayName": "Laptop",
        "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "keyAlgorithm": "EC",
      },
    ]
  `);

  // The same fingerprint cannot be registered twice within a tenancy (even via a different AuthMethod).
  await expect(sql`
    INSERT INTO "MtlsAuthMethod" (
      "tenancyId", "authMethodId", "projectUserId", "createdAt", "updatedAt",
      "fingerprint", "publicKey", "certificatePem", "subject", "issuer",
      "serialNumber", "keyAlgorithm", "signatureAlgorithm", "validFrom", "validTo"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.authMethodId2}::uuid, ${ctx.projectUserId}::uuid, NOW(), NOW(),
      ${fingerprintA}, 'pub-a2', 'pem', 'CN=Alice', 'CN=Alice', '02', 'EC', 'ecdsa-with-SHA256', NOW(), NOW() + INTERVAL '1 day'
    )
  `).rejects.toThrow(/MtlsAuthMethod_tenancyId_fingerprint_key/);

  // A second, distinct certificate for the SAME user succeeds (multi-cert support).
  await sql`
    INSERT INTO "MtlsAuthMethod" (
      "tenancyId", "authMethodId", "projectUserId", "createdAt", "updatedAt",
      "fingerprint", "publicKey", "certificatePem", "subject", "issuer",
      "serialNumber", "keyAlgorithm", "signatureAlgorithm", "validFrom", "validTo"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.authMethodId3}::uuid, ${ctx.projectUserId}::uuid, NOW(), NOW(),
      ${fingerprintB}, 'pub-b', 'pem', 'CN=Alice Desktop', 'CN=Alice Desktop', '03', 'RSA', 'sha256WithRSAEncryption', NOW(), NOW() + INTERVAL '1 day'
    )
  `;
  const userCerts = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM "MtlsAuthMethod"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  expect(userCerts[0].count).toBe("2");

  // Deleting the ProjectUser cascades to the certificates (via AuthMethod and the direct FK).
  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  const remaining = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM "MtlsAuthMethod"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(remaining[0].count).toBe("0");
};
