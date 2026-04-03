import { generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { mergeAnonymousUserIntoAuthenticatedUser } from "@/lib/user-merge";
import { globalPrismaClient, getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

type CliSessionState = "anonymous" | "none";

async function getPendingCliAuthAttempt(tenancyId: string, loginCode: string) {
  const cliAuth = await globalPrismaClient.cliAuthAttempt.findUnique({
    where: {
      loginCode,
    },
  });

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
  const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findUnique({
    where: {
      refreshToken,
    },
  });

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

  const user = await globalPrismaClient.projectUser.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId,
        projectUserId: refreshTokenObj.projectUserId,
      },
    },
    select: {
      projectUserId: true,
      isAnonymous: true,
    },
  });

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
    const prisma = await getPrismaClientForTenancy(tenancy);
    const cliAuth = await getPendingCliAuthAttempt(tenancy.id, login_code);
    const cliAnonymousSession = await getCliAnonymousSession(tenancy.id, cliAuth.anonRefreshToken);

    if (mode === "check") {
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

    await retryTransaction(prisma, async (tx) => {
      // Re-verify the CLI auth attempt is still pending inside the transaction
      // to prevent race conditions with concurrent complete requests
      const freshCliAuth = await tx.cliAuthAttempt.findFirst({
        where: {
          tenancyId: tenancy.id,
          id: cliAuth.id,
          refreshToken: null,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!freshCliAuth) {
        throw new StatusError(400, "Invalid login code or the code has expired");
      }

      if (
        cliAnonymousSession
        && cliAnonymousSession.userId !== browserRefreshTokenSession.projectUserId
      ) {
        await mergeAnonymousUserIntoAuthenticatedUser(tx, {
          tenancy,
          anonymousUserId: cliAnonymousSession.userId,
          authenticatedUserId: browserRefreshTokenSession.projectUserId,
        });
      }

      await tx.cliAuthAttempt.update({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: freshCliAuth.id,
          },
        },
        data: {
          refreshToken: refresh_token,
          anonRefreshToken: null,
        },
      });
    });

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        success: true,
      },
    };
  },
});
