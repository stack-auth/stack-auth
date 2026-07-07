import { createAgentAuthRegistration } from "@/lib/agent-auth-registration";
import { AGENT_AUTH_SCOPES_SUPPORTED, getAgentAuthClaimPageUrl } from "@/lib/agent-auth";
import { logEvent, SystemEventTypes } from "@/lib/events";
import { getApiUrlForRequest } from "@/lib/request-api-url";
import { getBillingTeamId } from "@/lib/plan-entitlements";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { ACCESS_TOKEN_EXPIRATION_SECONDS, createRefreshTokenObj, generateAccessTokenFromRefreshTokenIfValid } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { clientOrHigherAuthTypeSchema, adaptSchema, yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { randomInt } from "crypto";

const claimWindowMillis = 1000 * 60 * 60 * 24;
const claimAttemptWindowMillis = 1000 * 60 * 10;
const claimPollingIntervalSeconds = 5;
const preClaimScopes = [...AGENT_AUTH_SCOPES_SUPPORTED];
const postClaimScopes = [...AGENT_AUTH_SCOPES_SUPPORTED];

function createJsonResponse(statusCode: number, body: Json) {
  return {
    statusCode,
    bodyType: "json" as const,
    body,
  };
}

function sixDigitCode() {
  return randomInt(100000, 1000000).toString();
}

function toIsoString(value: Date | null | undefined) {
  return value == null ? null : value.toISOString();
}

function getDashboardUrl() {
  return getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL");
}

function getProjectScopedUrls(projectId: string, claimAttemptToken: string) {
  const dashboardUrl = getDashboardUrl();
  const verificationUri = getAgentAuthClaimPageUrl(dashboardUrl, { claimAttemptToken, projectId });
  return { verificationUri };
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      project: adaptSchema.optional(),
      user: adaptSchema.optional(),
    }).nullable().optional(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      type: yupString().oneOf(["anonymous", "service_auth"]).defined(),
      login_hint: yupString().optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    const schema = await getPrismaSchemaForTenancy(tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);

    if (body.type === "anonymous") {
      if (tenancy.config.agentAuth.identityTypes.anonymous !== true) {
        return createJsonResponse(400, {
          error: "anonymous_not_enabled",
        });
      }

      const anonymousUser = await usersCrudHandlers.adminCreate({
        tenancy,
        data: {
          is_anonymous: true,
        },
        allowedErrorTypes: [],
      });

      const refreshTokenObj = await createRefreshTokenObj({
        tenancy,
        projectUserId: anonymousUser.id,
      });
      const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
        tenancy,
        refreshTokenObj,
        apiUrl: getApiUrlForRequest(fullReq),
      }) ?? throwErr("Failed to generate access token for new anonymous agent auth registration", { refreshTokenObj });

      // WorkOS `identity_assertion` maps to Stack Auth's refresh token here:
      // it is the long-lived credential that the token endpoint exchanges for
      // fresh access tokens after the claim ceremony completes.
      const claimToken = generateSecureRandomString();
      const registration = await createAgentAuthRegistration(prisma, schema, {
        tenancyId: tenancy.id,
        type: "anonymous",
        loginHint: null,
        claimToken,
        expiresAt: new Date(Date.now() + claimWindowMillis),
        userId: anonymousUser.id,
        refreshTokenId: refreshTokenObj.id,
      });

      await logEvent([SystemEventTypes.AgentAuthRegistration], {
        projectId: tenancy.project.id,
        type: "anonymous",
      }, {
        billingTeamId: getBillingTeamId(tenancy.project),
      });

      return createJsonResponse(200, {
        registration: {
          id: registration.id,
          type: registration.type,
          status: registration.status,
          expires_at: registration.expiresAt.toISOString(),
        },
        identity_assertion: refreshTokenObj.refreshToken,
        assertion_expires: toIsoString(refreshTokenObj.expiresAt),
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_EXPIRATION_SECONDS,
        claim_token: claimToken,
        claim_token_expires_at: registration.expiresAt.toISOString(),
        pre_claim_scopes: preClaimScopes,
        post_claim_scopes: postClaimScopes,
      });
    }

    if (tenancy.config.agentAuth.identityTypes.serviceAuth !== true) {
      return createJsonResponse(400, {
        error: "service_auth_not_enabled",
      });
    }

    const loginHint = body.login_hint ?? null;
    if (loginHint == null) {
      return createJsonResponse(400, {
        error: "invalid_request",
        error_description: "login_hint is required for service_auth registrations",
      });
    }

    const claimToken = generateSecureRandomString();
    const claimAttemptToken = generateSecureRandomString();
    const userCode = sixDigitCode();
    const claimAttemptExpiresAt = new Date(Date.now() + claimAttemptWindowMillis);

    const registration = await createAgentAuthRegistration(prisma, schema, {
      tenancyId: tenancy.id,
      type: "service_auth",
      loginHint,
      claimToken,
      claimAttemptToken,
      userCode,
      claimAttemptExpiresAt,
      expiresAt: new Date(Date.now() + claimWindowMillis),
    });

    const { verificationUri } = getProjectScopedUrls(params.project_id, claimAttemptToken);

    await logEvent([SystemEventTypes.AgentAuthRegistration], {
      projectId: tenancy.project.id,
      type: "service_auth",
    }, {
      billingTeamId: getBillingTeamId(tenancy.project),
    });

    return createJsonResponse(200, {
      registration: {
        id: registration.id,
        type: registration.type,
        status: registration.status,
        expires_at: registration.expiresAt.toISOString(),
      },
      claim_token: claimToken,
      claim_token_expires_at: registration.expiresAt.toISOString(),
      claim: {
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}&user_code=${encodeURIComponent(userCode)}`,
        interval: claimPollingIntervalSeconds,
        expires_in: Math.floor(claimAttemptWindowMillis / 1000),
      },
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}&user_code=${encodeURIComponent(userCode)}`,
      post_claim_scopes: postClaimScopes,
    });
  },
});
