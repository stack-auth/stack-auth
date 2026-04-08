import { Prisma } from "@/generated/prisma/client";
import { generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

type CliSessionState = "anonymous" | "none";

type CliAuthAttemptRow = {
  id: string,
  tenancyId: string,
  refreshToken: string | null,
  anonRefreshToken: string | null,
  expiresAt: Date,
  usedAt: Date | null,
};

type RefreshTokenRow = {
  id: string,
  tenancyId: string,
  projectUserId: string,
  refreshToken: string,
  expiresAt: Date | null,
};

async function getPendingCliAuthAttempt(tenancyId: string, loginCode: string) {
  const rows = await globalPrismaClient.$queryRaw<CliAuthAttemptRow[]>(Prisma.sql`
    SELECT
      "id",
      "tenancyId",
      "refreshToken",
      "anonRefreshToken",
      "expiresAt",
      "usedAt"
    FROM "CliAuthAttempt"
    WHERE "loginCode" = ${loginCode}
    LIMIT 1
  `);
  const cliAuth = rows[0];

  if (!cliAuth) {
    throw new StatusError(400, "Invalid login code or the code has expired");
  }

  if (cliAuth.tenancyId !== tenancyId) {
    throw new StatusError(400, "Project ID mismatch; please ensure that you are using the correct app url.");
  }

  if (cliAuth.refreshToken !== null || cliAuth.usedAt !== null || cliAuth.expiresAt < new Date()) {
    throw new StatusError(400, "Invalid login code or the code has expired");
  }

  return cliAuth;
}

async function getRefreshTokenSession(tenancyId: string, refreshToken: string) {
  const rows = await globalPrismaClient.$queryRaw<RefreshTokenRow[]>(Prisma.sql`
    SELECT
      "id",
      "tenancyId",
      "projectUserId",
      "refreshToken",
      "expiresAt"
    FROM "ProjectUserRefreshToken"
    WHERE "refreshToken" = ${refreshToken}
    LIMIT 1
  `);
  const refreshTokenObj = rows[0];

  if (!refreshTokenObj) {
    return null;
  }

  if (refreshTokenObj.tenancyId !== tenancyId) {
    throw new StatusError(400, "Refresh token does not belong to this project");
  }

  if (refreshTokenObj.expiresAt !== null && refreshTokenObj.expiresAt < new Date()) {
    return null;
  }

  return refreshTokenObj;
}

async function getCliAnonymousSession(tenancyId: string, anonRefreshToken: string | null) {
  if (anonRefreshToken === null) {
    return null;
  }

  const refreshTokenObj = await getRefreshTokenSession(tenancyId, anonRefreshToken);
  if (!refreshTokenObj) {
    return null;
  }

  const userRows = await globalPrismaClient.$queryRaw<{ projectUserId: string, isAnonymous: boolean }[]>(Prisma.sql`
    SELECT "projectUserId", "isAnonymous"
    FROM "ProjectUser"
    WHERE "tenancyId" = ${tenancyId}::UUID
      AND "projectUserId" = ${refreshTokenObj.projectUserId}::UUID
    LIMIT 1
  `);
  const user = userRows[0];

  if (!user?.isAnonymous) {
    return null;
  }

  return {
    refreshTokenObj,
    userId: user.projectUserId,
  };
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Complete CLI authentication",
    description: "Inspect, claim, or complete a CLI authentication session",
    tags: ["CLI Authentication"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      login_code: yupString().defined(),
      mode: yupString().oneOf(["check", "claim-anon-session", "complete"]).default("complete"),
      refresh_token: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().optional(),
      cli_session_state: yupString().oneOf(["anonymous", "none"]).optional(),
      access_token: yupString().optional(),
      refresh_token: yupString().optional(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { login_code, mode, refresh_token } }) {
    const cliAuth = await getPendingCliAuthAttempt(tenancy.id, login_code);

    if (mode === "check") {
      const cliAnonymousSession = await getCliAnonymousSession(tenancy.id, cliAuth.anonRefreshToken);
      const cliSessionState: CliSessionState = cliAnonymousSession ? "anonymous" : "none";

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          cli_session_state: cliSessionState,
        },
      };
    }

    if (mode === "claim-anon-session") {
      const cliAnonymousSession = await getCliAnonymousSession(tenancy.id, cliAuth.anonRefreshToken);
      if (!cliAnonymousSession) {
        throw new StatusError(400, "No anonymous session associated with this code");
      }

      const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
        tenancy,
        refreshTokenObj: cliAnonymousSession.refreshTokenObj,
      });

      if (!accessToken) {
        throw new StatusError(400, "Anonymous session is no longer valid");
      }

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          access_token: accessToken,
          refresh_token: cliAnonymousSession.refreshTokenObj.refreshToken,
        },
      };
    }

    if (!refresh_token) {
      throw new StatusError(400, "refresh_token is required when mode is 'complete'");
    }

    const browserRefreshTokenSession = await getRefreshTokenSession(tenancy.id, refresh_token);
    if (!browserRefreshTokenSession) {
      throw new StatusError(400, "Invalid refresh token");
    }

    // Atomically claim the pending CLI auth attempt. Any anonymous session
    // attached to this attempt is intentionally ignored — we do NOT merge
    // the anonymous user into the authenticated user (that was a security risk).
    // The anonymous user is left untouched and will simply be orphaned from
    // this CLI flow.
    const claimed = await globalPrismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "CliAuthAttempt"
      SET
        "refreshToken" = ${refresh_token},
        "anonRefreshToken" = NULL,
        "updatedAt" = NOW()
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "id" = ${cliAuth.id}::UUID
        AND "refreshToken" IS NULL
        AND "usedAt" IS NULL
        AND "expiresAt" > NOW()
      RETURNING "id"
    `);

    if (claimed.length === 0) {
      throw new StatusError(400, "Invalid login code or the code has expired");
    }

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        success: true,
      },
    };
  },
});
