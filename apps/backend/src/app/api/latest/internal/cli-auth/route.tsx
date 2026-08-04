import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const recentAttemptLimit = 50;
const activeTokenAttemptLimit = 200;

type CliAuthAttemptRow = {
  id: string,
  status: "pending" | "completed" | "expired" | "used",
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
        attempts_in_window: yupNumber().integer().defined(),
        completed_attempts_in_window: yupNumber().integer().defined(),
        used_attempts_in_window: yupNumber().integer().defined(),
        expired_attempts_in_window: yupNumber().integer().defined(),
        pending_attempts_in_window: yupNumber().integer().defined(),
        active_tokens_in_lookup_window: yupNumber().integer().defined(),
        attempt_window_limit: yupNumber().integer().defined(),
        active_token_lookup_window_limit: yupNumber().integer().defined(),
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

    // These dashboard metrics intentionally describe a bounded recent window.
    // Exact all-time aggregates would scan unbounded history on every page load.
    const recentAttempts = await prisma.$replica().$queryRaw<CliAuthAttemptRow[]>(Prisma.sql`
      SELECT
        "id",
        CASE
          WHEN "usedAt" IS NOT NULL THEN 'used'
          WHEN "expiresAt" < ${now} THEN 'expired'
          WHEN "refreshToken" IS NOT NULL THEN 'completed'
          ELSE 'pending'
        END AS "status",
        "expiresAt",
        "usedAt",
        "createdAt"
      FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
      WHERE "tenancyId" = ${tenancy.id}::UUID
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${recentAttemptLimit}
    `);

    let used = 0;
    let completed = 0;
    let expired = 0;
    let pending = 0;
    for (const attempt of recentAttempts) {
      switch (attempt.status) {
        case "used": {
          used++;
          break;
        }
        case "completed": {
          completed++;
          break;
        }
        case "expired": {
          expired++;
          break;
        }
        case "pending": {
          pending++;
          break;
        }
      }
    }

    const formattedAttempts = recentAttempts.map((attempt) => {
      return {
        id: attempt.id,
        status: attempt.status,
        created_at: attempt.createdAt.toISOString(),
        expires_at: attempt.expiresAt.toISOString(),
        used_at: attempt.usedAt?.toISOString() ?? null,
      };
    });

    // Apply LIMIT before the nullable-column predicates. Otherwise LIMIT only
    // bounds returned rows and a tenant with sparse completed attempts could
    // scan its entire history looking for 200 qualifying entries.
    const cliRefreshTokens = await prisma.$replica().$queryRaw<{ refreshToken: string }[]>(Prisma.sql`
      WITH "recentAttempts" AS MATERIALIZED (
        SELECT "refreshToken", "usedAt"
        FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
        WHERE "tenancyId" = ${tenancy.id}::UUID
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT ${activeTokenAttemptLimit}
      )
      SELECT "refreshToken"
      FROM "recentAttempts"
      WHERE "refreshToken" IS NOT NULL
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
    let activeTokenCount = 0;

    if (cliRefreshTokens.length > 0) {
      const tokenValues = cliRefreshTokens.map((row) => row.refreshToken);
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
        LIMIT ${activeTokenAttemptLimit}
      `);
      activeTokenCount = activeTokens.filter((token) => token.expiresAt == null || token.expiresAt >= now).length;

      if (activeTokens.length > 0) {
        const userIds = [...new Set(activeTokens.map((token) => token.projectUserId))];
        const userRows = await prisma.$replica().$queryRaw<ProjectUserRow[]>(Prisma.sql`
          SELECT
            pu."projectUserId",
            pu."displayName",
            cc."value" AS "primaryEmail"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser" pu
          LEFT JOIN ${sqlQuoteIdent(schema)}."ContactChannel" cc
            ON cc."tenancyId" = pu."tenancyId"
            AND cc."projectUserId" = pu."projectUserId"
            AND cc."type"::text = 'EMAIL'
            AND cc."isPrimary"::text = 'TRUE'
          WHERE pu."tenancyId" = ${tenancy.id}::UUID
            AND pu."projectUserId" = ANY(${userIds}::UUID[])
        `);
        const usersById = new Map(userRows.map((user) => [user.projectUserId, user]));

        activeCliUsers = activeTokens.map((token) => {
          const user = usersById.get(token.projectUserId);
          return {
            user_id: token.projectUserId,
            display_name: user?.displayName ?? null,
            primary_email: user?.primaryEmail ?? null,
            token_created_at: token.createdAt.toISOString(),
            last_active_at: token.lastActiveAt.toISOString(),
            expires_at: token.expiresAt?.toISOString() ?? null,
            is_expired: token.expiresAt != null && token.expiresAt < now,
          };
        });
      }
    }

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        summary: {
          attempts_in_window: recentAttempts.length,
          completed_attempts_in_window: completed,
          used_attempts_in_window: used,
          expired_attempts_in_window: expired,
          pending_attempts_in_window: pending,
          active_tokens_in_lookup_window: activeTokenCount,
          attempt_window_limit: recentAttemptLimit,
          active_token_lookup_window_limit: activeTokenAttemptLimit,
        },
        recent_attempts: formattedAttempts,
        active_cli_users: activeCliUsers,
      },
    };
  },
});
