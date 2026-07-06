import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

type CliAuthAttemptRow = {
  id: string,
  pollingCode: string,
  loginCode: string,
  refreshToken: string | null,
  expiresAt: Date,
  usedAt: Date | null,
  createdAt: Date,
};

type ActiveCliTokenRow = {
  id: string,
  projectUserId: string,
  createdAt: Date,
  lastActiveAt: Date,
  expiresAt: Date | null,
};

type ProjectUserRow = {
  projectUserId: string,
  displayName: string | null,
  primaryEmail: string | null,
};

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      summary: yupObject({
        total_attempts: yupNumber().integer().defined(),
        completed_attempts: yupNumber().integer().defined(),
        expired_attempts: yupNumber().integer().defined(),
        pending_attempts: yupNumber().integer().defined(),
        active_tokens: yupNumber().integer().defined(),
      }).defined(),
      recent_attempts: yupArray(yupObject({
        id: yupString().defined(),
        status: yupString().oneOf(["pending", "completed", "expired", "used"]).defined(),
        created_at: yupString().defined(),
        expires_at: yupString().defined(),
        used_at: yupString().nullable().defined(),
      }).defined()).defined(),
      active_cli_users: yupArray(yupObject({
        user_id: yupString().defined(),
        display_name: yupString().nullable().defined(),
        primary_email: yupString().nullable().defined(),
        token_created_at: yupString().defined(),
        last_active_at: yupString().defined(),
        expires_at: yupString().nullable().defined(),
        is_expired: yupBoolean().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const tenancy = req.auth.tenancy;
    const prisma = await getPrismaClientForTenancy(tenancy);
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const now = new Date();

    // Fetch recent CLI auth attempts (last 50)
    const recentAttempts = await prisma.$replica().$queryRaw<CliAuthAttemptRow[]>(Prisma.sql`
      SELECT
        "id",
        "pollingCode",
        "loginCode",
        "refreshToken",
        "expiresAt",
        "usedAt",
        "createdAt"
      FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
      WHERE "tenancyId" = ${tenancy.id}::UUID
      ORDER BY "createdAt" DESC
      LIMIT 50
    `);

    // Compute summary stats
    let completed = 0;
    let expired = 0;
    let pending = 0;
    for (const attempt of recentAttempts) {
      if (attempt.usedAt != null) {
        completed++;
      } else if (attempt.expiresAt < now) {
        expired++;
      } else if (attempt.refreshToken != null) {
        // Refresh token assigned but not yet polled/used — treat as completed
        completed++;
      } else {
        pending++;
      }
    }

    // Format recent attempts with status
    const formattedAttempts = recentAttempts.map((attempt) => {
      let status: "pending" | "completed" | "expired" | "used";
      if (attempt.usedAt != null) {
        status = "used";
      } else if (attempt.refreshToken != null && attempt.expiresAt >= now) {
        status = "completed";
      } else if (attempt.expiresAt < now) {
        status = "expired";
      } else {
        status = "pending";
      }
      return {
        id: attempt.id,
        status,
        created_at: attempt.createdAt.toISOString(),
        expires_at: attempt.expiresAt.toISOString(),
        used_at: attempt.usedAt?.toISOString() ?? null,
      };
    });

    // Find active CLI tokens: tokens that were created via CLI auth (by looking
    // at CliAuthAttempt rows that have a non-null refreshToken and usedAt).
    // We join with the global ProjectUserRefreshToken table to find active sessions.
    const cliRefreshTokens = await prisma.$replica().$queryRaw<{ refreshToken: string }[]>(Prisma.sql`
      SELECT "refreshToken"
      FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "refreshToken" IS NOT NULL
        AND "usedAt" IS NOT NULL
    `);

    let activeCliUsers: Array<{
      user_id: string,
      display_name: string | null,
      primary_email: string | null,
      token_created_at: string,
      last_active_at: string,
      expires_at: string | null,
      is_expired: boolean,
    }> = [];

    if (cliRefreshTokens.length > 0) {
      const tokenValues = cliRefreshTokens.map((r) => r.refreshToken);

      // Look up which tokens are still active in the global refresh token table
      const activeTokens = await globalPrismaClient.$replica().$queryRaw<ActiveCliTokenRow[]>(Prisma.sql`
        SELECT
          "id",
          "projectUserId",
          "createdAt",
          "lastActiveAt",
          "expiresAt"
        FROM "ProjectUserRefreshToken"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "refreshToken" = ANY(${tokenValues})
        ORDER BY "lastActiveAt" DESC
        LIMIT 50
      `);

      if (activeTokens.length > 0) {
        // Fetch user info for the active tokens
        const userIds = [...new Set(activeTokens.map((t) => t.projectUserId))];
        const userRows = await prisma.$replica().$queryRaw<ProjectUserRow[]>(Prisma.sql`
          SELECT
            "projectUserId",
            "displayName",
            "primaryEmail"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "projectUserId" = ANY(${userIds}::UUID[])
        `);
        const userMap = new Map(userRows.map((u) => [u.projectUserId, u]));

        activeCliUsers = activeTokens.map((token) => {
          const user = userMap.get(token.projectUserId);
          const isExpired = token.expiresAt != null && token.expiresAt < now;
          return {
            user_id: token.projectUserId,
            display_name: user?.displayName ?? null,
            primary_email: user?.primaryEmail ?? null,
            token_created_at: token.createdAt.toISOString(),
            last_active_at: token.lastActiveAt.toISOString(),
            expires_at: token.expiresAt?.toISOString() ?? null,
            is_expired: isExpired,
          };
        });
      }
    }

    const activeTokenCount = activeCliUsers.filter((u) => !u.is_expired).length;

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        summary: {
          total_attempts: recentAttempts.length,
          completed_attempts: completed,
          expired_attempts: expired,
          pending_attempts: pending,
          active_tokens: activeTokenCount,
        },
        recent_attempts: formattedAttempts,
        active_cli_users: activeCliUsers,
      },
    };
  },
});
