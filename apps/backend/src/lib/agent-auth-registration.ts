import { Prisma } from "@/generated/prisma/client";
import { sqlQuoteIdent } from "@/prisma-client";
import type { PrismaClientWithReplica } from "@/prisma-client";

export type AgentAuthRegistrationType = "anonymous" | "service_auth";
export type AgentAuthRegistrationStatus = "pending" | "claimed" | "expired";

export type AgentAuthRegistrationRow = {
  tenancyId: string,
  id: string,
  type: AgentAuthRegistrationType,
  status: AgentAuthRegistrationStatus,
  loginHint: string | null,
  claimToken: string,
  claimAttemptToken: string | null,
  userCode: string | null,
  claimAttemptExpiresAt: Date | null,
  expiresAt: Date,
  userId: string | null,
  refreshTokenId: string | null,
  lastPollAt: Date | null,
  usedAt: Date | null,
  claimedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
};

function selectColumns(schema: string) {
  return Prisma.sql`
    SELECT
      "tenancyId",
      "id",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "createdAt",
      "updatedAt"
    FROM ${sqlQuoteIdent(schema)}."AgentAuthRegistration"
  `;
}

export async function getAgentAuthRegistrationByClaimToken(prisma: PrismaClientWithReplica, schema: string, claimToken: string): Promise<AgentAuthRegistrationRow | null> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    ${selectColumns(schema)}
    WHERE "claimToken" = ${claimToken}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getAgentAuthRegistrationByClaimAttemptToken(prisma: PrismaClientWithReplica, schema: string, claimAttemptToken: string): Promise<AgentAuthRegistrationRow | null> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    ${selectColumns(schema)}
    WHERE "claimAttemptToken" = ${claimAttemptToken}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function createAgentAuthRegistration(prisma: PrismaClientWithReplica, schema: string, options: {
  tenancyId: string,
  type: AgentAuthRegistrationType,
  loginHint: string | null,
  claimToken: string,
  claimAttemptToken?: string | null,
  userCode?: string | null,
  claimAttemptExpiresAt?: Date | null,
  expiresAt: Date,
  userId?: string | null,
  refreshTokenId?: string | null,
  lastPollAt?: Date | null,
}): Promise<AgentAuthRegistrationRow> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    INSERT INTO ${sqlQuoteIdent(schema)}."AgentAuthRegistration" (
      "tenancyId",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "updatedAt"
    )
    VALUES (
      ${options.tenancyId}::UUID,
      ${options.type},
      'pending',
      ${options.loginHint},
      ${options.claimToken},
      ${options.claimAttemptToken ?? null},
      ${options.userCode ?? null},
      ${options.claimAttemptExpiresAt ?? null},
      ${options.expiresAt},
      ${options.userId ?? null},
      ${options.refreshTokenId ?? null},
      ${options.lastPollAt ?? null},
      NULL,
      NULL,
      NOW()
    )
    RETURNING
      "tenancyId",
      "id",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "createdAt",
      "updatedAt"
  `);
  if (rows.length === 0) {
    throw new Error("Agent auth registration insert failed");
  }
  return rows[0];
}

export async function updateAgentAuthClaimAttempt(prisma: PrismaClientWithReplica, schema: string, options: {
  claimToken: string,
  loginHint: string | null,
  claimAttemptToken: string,
  userCode: string,
  claimAttemptExpiresAt: Date,
}): Promise<AgentAuthRegistrationRow | null> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    UPDATE ${sqlQuoteIdent(schema)}."AgentAuthRegistration"
    SET
      "claimAttemptToken" = ${options.claimAttemptToken},
      "userCode" = ${options.userCode},
      "loginHint" = COALESCE(${options.loginHint}, "loginHint"),
      "claimAttemptExpiresAt" = ${options.claimAttemptExpiresAt},
      "updatedAt" = NOW()
    WHERE "claimToken" = ${options.claimToken}
      AND "usedAt" IS NULL
      AND "expiresAt" > NOW()
    RETURNING
      "tenancyId",
      "id",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "createdAt",
      "updatedAt"
  `);
  return rows[0] ?? null;
}

export async function markAgentAuthClaimPolled(prisma: PrismaClientWithReplica, schema: string, options: {
  claimToken: string,
}): Promise<AgentAuthRegistrationRow | null> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    UPDATE ${sqlQuoteIdent(schema)}."AgentAuthRegistration"
    SET
      "lastPollAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "claimToken" = ${options.claimToken}
      AND "usedAt" IS NULL
      AND "expiresAt" > NOW()
    RETURNING
      "tenancyId",
      "id",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "createdAt",
      "updatedAt"
  `);
  return rows[0] ?? null;
}

export async function claimAgentAuthRegistration(prisma: PrismaClientWithReplica, schema: string, options: {
  claimAttemptToken: string,
  userCode: string,
  userId: string,
  refreshTokenId: string,
}): Promise<AgentAuthRegistrationRow | null> {
  const rows = await prisma.$queryRaw<AgentAuthRegistrationRow[]>(Prisma.sql`
    UPDATE ${sqlQuoteIdent(schema)}."AgentAuthRegistration"
    SET
      "status" = 'claimed',
      "userId" = ${options.userId}::UUID,
      "refreshTokenId" = ${options.refreshTokenId}::UUID,
      "usedAt" = NOW(),
      "claimedAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "claimAttemptToken" = ${options.claimAttemptToken}
      AND "userCode" = ${options.userCode}
      AND "usedAt" IS NULL
      AND "expiresAt" > NOW()
      AND "claimAttemptExpiresAt" > NOW()
    RETURNING
      "tenancyId",
      "id",
      "type",
      "status",
      "loginHint",
      "claimToken",
      "claimAttemptToken",
      "userCode",
      "claimAttemptExpiresAt",
      "expiresAt",
      "userId",
      "refreshTokenId",
      "lastPollAt",
      "usedAt",
      "claimedAt",
      "createdAt",
      "updatedAt"
  `);
  return rows[0] ?? null;
}
