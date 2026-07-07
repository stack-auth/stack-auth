import { getApiUrlForRequest } from "@/lib/request-api-url";
import { AGENT_AUTH_EVENTS_SUPPORTED, AGENT_AUTH_SCOPES_SUPPORTED, getAgentAuthIdentityTypesSupported, getAgentAuthProjectUrls, renderAgentAuthManifest } from "@/lib/agent-auth";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { ACCESS_TOKEN_EXPIRATION_SECONDS } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

function getDashboardUrl() {
  return getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL");
}

export const GET = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    params: yupObject({
      project_id: yupString().defined(),
    }),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null) {
      throw new StatusError(404, "Project not found");
    }

    if (tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      throw new StatusError(404, "Project not found");
    }

    const urls = getAgentAuthProjectUrls(getApiUrlForRequest(fullReq), params.project_id);
    const claimPageUrl = new URL(`/projects/${encodeURIComponent(params.project_id)}/agent-auth-app/claim`, getDashboardUrl()).toString();
    const apiKeysEnableUrl = new URL(`/projects/${encodeURIComponent(params.project_id)}/api-keys-app`, getDashboardUrl()).toString();
    const manifest = renderAgentAuthManifest({
      projectName: tenancy.project.display_name,
      resourceUrl: urls.resourceMetadataUrl,
      authorizationServerUrl: urls.authorizationServerMetadataUrl,
      authMdUrl: urls.authMdUrl,
      identityEndpointUrl: urls.identityEndpointUrl,
      claimEndpointUrl: urls.claimEndpointUrl,
      claimPageUrl,
      eventsEndpointUrl: urls.eventsEndpointUrl,
      tokenEndpointUrl: urls.tokenEndpointUrl,
      revocationEndpointUrl: urls.revocationEndpointUrl,
      apiKeysEndpointUrl: urls.apiKeysEndpointUrl,
      apiKeysEnableUrl,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRATION_SECONDS,
      claimAttemptExpiresInSeconds: 10 * 60,
      scopesSupported: AGENT_AUTH_SCOPES_SUPPORTED,
      identityTypesSupported: getAgentAuthIdentityTypesSupported(tenancy.config),
      eventsSupported: AGENT_AUTH_EVENTS_SUPPORTED,
      resourceLogoUrl: tenancy.project.logo_url ?? tenancy.project.logo_full_url ?? null,
    });

    return {
      statusCode: 200,
      bodyType: "response",
      body: new Response(manifest, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
        },
      }),
    };
  },
});
