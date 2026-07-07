import { getAgentAuthRegistrationByClaimToken, updateAgentAuthClaimAttempt } from "@/lib/agent-auth-registration";
import { getAgentAuthClaimPageUrl } from "@/lib/agent-auth";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { randomInt } from "crypto";

const claimAttemptWindowMillis = 1000 * 60 * 10;
const claimWindowMillis = 1000 * 60 * 60 * 24;
const claimPollingIntervalSeconds = 5;

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

function getDashboardUrl() {
  return getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL");
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      claim_token: yupString().defined(),
      email: yupString().optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const registration = await getAgentAuthRegistrationByClaimToken(prisma, schema, body.claim_token);
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

    if (registration.expiresAt <= new Date()) {
      return createJsonResponse(410, {
        error: "claim_expired",
      });
    }

    if (registration.claimAttemptToken != null && registration.claimAttemptExpiresAt != null && registration.claimAttemptExpiresAt > new Date()) {
      return createJsonResponse(400, {
        error: "claimed_or_in_flight",
      });
    }

    const claimAttemptToken = generateSecureRandomString();
    const userCode = sixDigitCode();
    const claimAttemptExpiresAt = new Date(Date.now() + claimAttemptWindowMillis);
    const updated = await updateAgentAuthClaimAttempt(prisma, schema, {
      claimToken: body.claim_token,
      loginHint: body.email ?? registration.loginHint,
      claimAttemptToken,
      userCode,
      claimAttemptExpiresAt,
    });
    if (updated == null) {
      return createJsonResponse(400, {
        error: "claim_expired",
      });
    }

    const verificationUri = getAgentAuthClaimPageUrl(getDashboardUrl(), {
      claimAttemptToken,
      projectId: params.project_id,
    });

    return createJsonResponse(200, {
      claim: {
        claim_token: body.claim_token,
        claim_attempt_token: claimAttemptToken,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}&user_code=${encodeURIComponent(userCode)}`,
        interval: claimPollingIntervalSeconds,
        expires_in: Math.floor(claimAttemptWindowMillis / 1000),
        claim_attempt_expires_in: Math.floor(claimAttemptWindowMillis / 1000),
        claim_token_expires_in: Math.floor(claimWindowMillis / 1000),
      },
      registration: {
        id: updated.id,
        status: updated.status,
        type: updated.type,
      },
    });
  },
});
