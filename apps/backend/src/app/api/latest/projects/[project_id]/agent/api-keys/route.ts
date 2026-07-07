import { isFeatureDisabled } from "@/app/api/latest/(api-keys)/handlers";
import { logEvent, SystemEventTypes } from "@/lib/events";
import { getBillingTeamId } from "@/lib/plan-entitlements";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { createProjectApiKey } from "@hexclave/shared/dist/utils/api-keys";
import { clientOrHigherAuthTypeSchema, adaptSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";

function createJsonResponse(statusCode: number, body: Json) {
  return {
    statusCode,
    bodyType: "json" as const,
    body,
  };
}

function getDashboardUrl() {
  return getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL");
}

function getEnableUrl(projectId: string) {
  return new URL(`/projects/${encodeURIComponent(projectId)}/api-keys-app`, getDashboardUrl()).toString();
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      project: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      description: yupString().defined(),
      expires_at_millis: yupNumber().nullable().defined(),
      is_public: yupBoolean().optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ auth, params, body }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    if (tenancy.config.apps.installed["api-keys"]?.enabled !== true || isFeatureDisabled(tenancy, "user")) {
      return createJsonResponse(403, {
        error: "api_keys_app_not_enabled",
        error_description: "Agent API key issuance is not enabled for this project.",
        enable_url: getEnableUrl(params.project_id),
      });
    }

    const currentUser = auth.user;
    if (currentUser == null || currentUser.is_anonymous === true) {
      return createJsonResponse(401, {
        error: "access_denied",
      });
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const apiKeyId = generateUuid();
    const isPublic = body.is_public ?? false;
    const secretApiKey = createProjectApiKey({
      id: apiKeyId,
      isPublic,
      isCloudVersion: new URL(fullReq.url).hostname === "api.hexclave.com" || new URL(fullReq.url).hostname === "api.stack-auth.com",
      type: "user",
    });
    const apiKey = await prisma.projectApiKey.create({
      data: {
        id: apiKeyId,
        description: body.description,
        secretApiKey,
        isPublic,
        expiresAt: body.expires_at_millis == null ? undefined : new Date(body.expires_at_millis),
        createdAt: new Date(),
        projectUserId: currentUser.id,
        tenancyId: tenancy.id,
      },
    });

    await logEvent([SystemEventTypes.AgentAuthApiKeyIssued], {
      projectId: tenancy.project.id,
      userId: currentUser.id,
    }, {
      billingTeamId: getBillingTeamId(tenancy.project),
    });

    return createJsonResponse(200, {
      id: apiKey.id,
      description: apiKey.description,
      is_public: apiKey.isPublic,
      created_at_millis: apiKey.createdAt.getTime(),
      expires_at_millis: apiKey.expiresAt == null ? null : apiKey.expiresAt.getTime(),
      manually_revoked_at_millis: apiKey.manuallyRevokedAt == null ? null : apiKey.manuallyRevokedAt.getTime(),
      value: apiKey.secretApiKey,
      user_id: apiKey.projectUserId == null ? null : apiKey.projectUserId,
      type: "user",
    });
  },
});
