import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { Prisma } from "@/generated/prisma/client";
import { Tenancy } from "@/lib/tenancies";
import { generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import type { InferType } from "yup";

type CliSessionState = "anonymous" | "none";

const postCliAuthCompleteRequestSchema = yupObject({
  auth: yupObject({
    type: clientOrHigherAuthTypeSchema,
    tenancy: adaptSchema.defined(),
  }).defined(),
  body: yupObject({
    login_code: yupString().defined(),
    mode: yupString().oneOf(["check", "claim-anon-session", "complete"]).default("complete"),
    refresh_token: yupString().optional(),
  }).defined(),
});

const postCliAuthCompleteResponseSchema = yupUnion(
  yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      cli_session_state: yupString().oneOf(["anonymous", "none"]).defined(),
    }).defined(),
  }).defined(),
  yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
    }).defined(),
  }).defined(),
  yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }).defined(),
).defined();

type PostCliAuthCompleteRequest = InferType<typeof postCliAuthCompleteRequestSchema>;
type PostCliAuthCompleteResponse = InferType<typeof postCliAuthCompleteResponseSchema>;

function cliAuthCompleteCheckResponse(cliSessionState: CliSessionState): PostCliAuthCompleteResponse {
  return {
    statusCode: 200,
    bodyType: "json",
    body: {
      cli_session_state: cliSessionState,
    },
  };
}

function cliAuthCompleteClaimResponse(accessToken: string, refreshToken: string): PostCliAuthCompleteResponse {
  return {
    statusCode: 200,
    bodyType: "json",
    body: {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
  };
}

function cliAuthCompleteSuccessResponse(): PostCliAuthCompleteResponse {
  return {
    statusCode: 200,
    bodyType: "json",
    body: {
      success: true,
    },
  };
}

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

async function getPendingCliAuthAttempt(tenancy: Tenancy, loginCode: string) {
  // CliAuthAttempt lives in the tenancy's source-of-truth DB, consistent with cli/poll/route.tsx.
  const prisma = await getPrismaClientForTenancy(tenancy);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const rows = await prisma.$queryRaw<CliAuthAttemptRow[]>(Prisma.sql`
    SELECT
      "id",
      "tenancyId",
      "refreshToken",
      "anonRefreshToken",
      "expiresAt",
      "usedAt"
    FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "loginCode" = ${loginCode}
    LIMIT 1
  `);
  if (rows.length === 0) {
    throw new StatusError(400, "Invalid login code or the code has expired");
  }
  const cliAuth = rows[0];

  if (cliAuth.refreshToken !== null || cliAuth.usedAt !== null || cliAuth.expiresAt < new Date()) {
    throw new StatusError(400, "Invalid login code or the code has expired");
  }

  return cliAuth;
}

async function getRefreshTokenSession(tenancyId: string, refreshToken: string) {
  // ProjectUserRefreshToken lives in the global DB (see tokens.tsx and oauth/model.tsx).
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
  if (rows.length === 0) {
    return null;
  }
  const refreshTokenObj = rows[0];

  if (refreshTokenObj.tenancyId !== tenancyId) {
    throw new StatusError(400, "Refresh token does not belong to this project");
  }

  if (refreshTokenObj.expiresAt !== null && refreshTokenObj.expiresAt < new Date()) {
    return null;
  }

  return refreshTokenObj;
}

async function getCliAnonymousSession(tenancy: Tenancy, anonRefreshToken: string | null) {
  if (anonRefreshToken === null) {
    return null;
  }

  const refreshTokenObj = await getRefreshTokenSession(tenancy.id, anonRefreshToken);
  if (!refreshTokenObj) {
    return null;
  }

  // ProjectUser lives in the tenancy's source-of-truth DB, not global.
  // Use the CRUD handler which is topology-aware (matches tokens.tsx:206).
  let user;
  try {
    user = await usersCrudHandlers.adminRead({
      tenancy,
      user_id: refreshTokenObj.projectUserId,
      allowedErrorTypes: [KnownErrors.UserNotFound],
    });
  } catch (error) {
    if (error instanceof KnownErrors.UserNotFound) {
      return null;
    }
    throw error;
  }

  if (!user.is_anonymous) {
    return null;
  }

  return {
    refreshTokenObj,
    userId: user.id,
  };
}

export const POST = createSmartRouteHandler<PostCliAuthCompleteRequest, PostCliAuthCompleteResponse>({
  metadata: {
    summary: "Complete CLI authentication",
    description: "Inspect, claim, or complete a CLI authentication session",
    tags: ["CLI Authentication"],
  },
  request: postCliAuthCompleteRequestSchema,
  response: postCliAuthCompleteResponseSchema,
  async handler({ auth: { tenancy }, body: { login_code, mode, refresh_token } }) {
    const cliAuth = await getPendingCliAuthAttempt(tenancy, login_code);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const schema = await getPrismaSchemaForTenancy(tenancy);

    if (mode === "check") {
      const cliAnonymousSession = await getCliAnonymousSession(tenancy, cliAuth.anonRefreshToken);
      const cliSessionState: CliSessionState = cliAnonymousSession ? "anonymous" : "none";

      return cliAuthCompleteCheckResponse(cliSessionState);
    }

    if (mode === "claim-anon-session") {
      const cliAnonymousSession = await getCliAnonymousSession(tenancy, cliAuth.anonRefreshToken);
      if (!cliAnonymousSession) {
        throw new StatusError(400, "No anonymous session associated with this code");
      }

      // Atomically consume the anon session (one-shot): null out anonRefreshToken
      // on the CliAuthAttempt row so subsequent claim-anon-session calls cannot
      // replay and re-retrieve the anon user's refresh token.
      const consumed = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE ${sqlQuoteIdent(schema)}."CliAuthAttempt"
        SET
          "anonRefreshToken" = NULL,
          "updatedAt" = NOW()
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "id" = ${cliAuth.id}::UUID
          AND "anonRefreshToken" = ${cliAuth.anonRefreshToken}
          AND "refreshToken" IS NULL
          AND "usedAt" IS NULL
          AND "expiresAt" > NOW()
        RETURNING "id"
      `);

      if (consumed.length === 0) {
        throw new StatusError(400, "No anonymous session associated with this code");
      }

      const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
        tenancy,
        refreshTokenObj: cliAnonymousSession.refreshTokenObj,
      });

      if (!accessToken) {
        throw new StatusError(400, "Anonymous session is no longer valid");
      }

      return cliAuthCompleteClaimResponse(accessToken, cliAnonymousSession.refreshTokenObj.refreshToken);
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
    const claimed = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE ${sqlQuoteIdent(schema)}."CliAuthAttempt"
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

    return cliAuthCompleteSuccessResponse();
  },
});
