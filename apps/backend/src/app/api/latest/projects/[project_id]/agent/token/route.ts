import { AGENT_AUTH_SCOPES_SUPPORTED } from "@/lib/agent-auth";
import { markAgentAuthClaimPolled, getAgentAuthRegistrationByClaimToken } from "@/lib/agent-auth-registration";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { ACCESS_TOKEN_EXPIRATION_SECONDS, generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { getApiUrlForRequest } from "@/lib/request-api-url";
import { getPrismaSchemaForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";

const claimPollingIntervalSeconds = 5;

function createJsonResponse(statusCode: number, body: Json) {
  return {
    statusCode,
    bodyType: "json" as const,
    body,
  };
}

function getTokenResponse(accessToken: string, identityAssertion: string, assertionExpires: Date | null) {
  const assertionExpiresAt = assertionExpires ?? throwErr("Missing assertion expiration for agent auth token exchange");
  return createJsonResponse(200, {
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRATION_SECONDS,
    scope: AGENT_AUTH_SCOPES_SUPPORTED.join(" "),
    access_token: accessToken,
    identity_assertion: identityAssertion,
    assertion_expires: assertionExpiresAt.toISOString(),
  });
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      grant_type: yupString().defined(),
      claim_token: yupString().optional(),
      assertion: yupString().optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    const schema = await getPrismaSchemaForTenancy(tenancy);

    if (body.grant_type === "urn:workos:agent-auth:grant-type:claim") {
      const claimToken = body.claim_token;
      if (claimToken == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      const registration = await getAgentAuthRegistrationByClaimToken(globalPrismaClient, schema, claimToken);
      if (registration == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      if (registration.expiresAt <= new Date()) {
        return createJsonResponse(400, {
          error: "expired_token",
        });
      }

      let completedRegistration = registration;
      if (registration.usedAt == null) {
        if (registration.claimAttemptExpiresAt != null && registration.claimAttemptExpiresAt <= new Date()) {
          return createJsonResponse(400, {
            error: "expired_token",
          });
        }

        if (registration.lastPollAt != null && Date.now() - registration.lastPollAt.getTime() < claimPollingIntervalSeconds * 1000) {
          return createJsonResponse(400, {
            error: "slow_down",
          });
        }

        const updated = await markAgentAuthClaimPolled(globalPrismaClient, schema, {
          claimToken,
        });
        if (updated == null) {
          return createJsonResponse(400, {
            error: "expired_token",
          });
        }

        if (updated.usedAt == null || updated.refreshTokenId == null) {
          return createJsonResponse(400, {
            error: "authorization_pending",
            interval: claimPollingIntervalSeconds,
          });
        }

        completedRegistration = updated;
      }

      if (completedRegistration.refreshTokenId == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findFirst({
        where: {
          tenancyId: tenancy.id,
          id: completedRegistration.refreshTokenId,
        },
      });

      if (refreshTokenObj == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
        tenancy,
        refreshTokenObj,
        apiUrl: getApiUrlForRequest(fullReq),
      });

      if (accessToken == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      return getTokenResponse(accessToken, refreshTokenObj.refreshToken, refreshTokenObj.expiresAt);
    }

    if (body.grant_type === "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      const assertion = body.assertion;
      if (assertion == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findFirst({
        where: {
          tenancyId: tenancy.id,
          refreshToken: assertion,
        },
      });

      if (refreshTokenObj == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
        tenancy,
        refreshTokenObj,
        apiUrl: getApiUrlForRequest(fullReq),
      });
      if (accessToken == null) {
        return createJsonResponse(400, {
          error: "invalid_grant",
        });
      }

      return getTokenResponse(accessToken, refreshTokenObj.refreshToken, refreshTokenObj.expiresAt);
    }

    return createJsonResponse(400, {
      error: "unsupported_grant_type",
    });
  },
});
