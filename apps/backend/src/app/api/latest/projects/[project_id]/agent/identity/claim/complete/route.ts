import { claimAgentAuthRegistration, getAgentAuthRegistrationByClaimAttemptToken } from "@/lib/agent-auth-registration";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getBillingTeamId } from "@/lib/plan-entitlements";
import { createRefreshTokenObj, generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { logEvent, SystemEventTypes } from "@/lib/events";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { recordExternalDbSyncDeletion } from "@/lib/external-db-sync";
import { getApiUrlForRequest } from "@/lib/request-api-url";
import { yupMixed, yupObject, yupString, adaptSchema, clientOrHigherAuthTypeSchema } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";

function createJsonResponse(statusCode: number, body: Json) {
  return {
    statusCode,
    bodyType: "json" as const,
    body,
  };
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema.optional(),
    }).defined(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      claim_attempt_token: yupString().defined(),
      user_code: yupString().defined(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ auth, params, body }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    const currentUser = auth.user;
    if (currentUser == null) {
      return createJsonResponse(401, {
        error: "access_denied",
      });
    }
    if (currentUser.is_anonymous === true) {
      return createJsonResponse(403, {
        error: "access_denied",
      });
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const registration = await getAgentAuthRegistrationByClaimAttemptToken(prisma, schema, body.claim_attempt_token);
    if (registration == null) {
      return createJsonResponse(400, {
        error: "invalid_claim_token",
      });
    }

    if (registration.usedAt != null) {
      return createJsonResponse(400, {
        error: "claimed_or_in_flight",
      });
    }

    if (registration.claimAttemptExpiresAt != null && registration.claimAttemptExpiresAt <= new Date()) {
      return createJsonResponse(410, {
        error: "claim_expired",
      });
    }

    if (registration.loginHint != null) {
      const signedInEmail = currentUser.primary_email;
      if (signedInEmail == null || signedInEmail.toLowerCase() !== registration.loginHint.toLowerCase()) {
        return createJsonResponse(403, {
          error: "access_denied",
        });
      }
      if (currentUser.primary_email_verified !== true) {
        return createJsonResponse(403, {
          error: "access_denied",
        });
      }
    }

    const refreshed = await createRefreshTokenObj({
      tenancy,
      projectUserId: currentUser.id,
    });

    const claimed = await claimAgentAuthRegistration(prisma, schema, {
      claimAttemptToken: body.claim_attempt_token,
      userCode: body.user_code,
      userId: currentUser.id,
      refreshTokenId: refreshed.id,
    });

    if (claimed == null) {
      await recordExternalDbSyncDeletion(globalPrismaClient, {
        tableName: "ProjectUserRefreshToken",
        tenancyId: tenancy.id,
        refreshTokenId: refreshed.id,
      });
      await globalPrismaClient.projectUserRefreshToken.deleteMany({
        where: {
          tenancyId: tenancy.id,
          id: refreshed.id,
        },
      });
      return createJsonResponse(400, {
        error: "invalid_claim_token",
      });
    }

    if (registration.refreshTokenId != null) {
      await recordExternalDbSyncDeletion(globalPrismaClient, {
        tableName: "ProjectUserRefreshToken",
        tenancyId: tenancy.id,
        refreshTokenId: registration.refreshTokenId,
      });
      await globalPrismaClient.projectUserRefreshToken.deleteMany({
        where: {
          tenancyId: tenancy.id,
          id: registration.refreshTokenId,
        },
      });
    }

    const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
      tenancy,
      refreshTokenObj: refreshed,
      apiUrl: getApiUrlForRequest(fullReq),
    }) ?? throwErr("Failed to generate access token after agent auth claim completion", { refreshed });

    const assertionExpires = refreshed.expiresAt ?? throwErr("Missing refresh token expiration after agent auth claim completion", { refreshed });

    await logEvent([SystemEventTypes.AgentAuthClaimCompleted], {
      projectId: tenancy.project.id,
      type: registration.type,
      userId: currentUser.id,
      is_new_user: registration.type === "anonymous" || currentUser.signed_up_at_millis >= registration.createdAt.getTime(),
    }, {
      billingTeamId: getBillingTeamId(tenancy.project),
    });

    return createJsonResponse(200, {
      success: true,
      access_token: accessToken,
      refresh_token: refreshed.refreshToken,
      user_id: currentUser.id,
      identity_assertion: refreshed.refreshToken,
      assertion_expires: assertionExpires.toISOString(),
    });
  },
});
