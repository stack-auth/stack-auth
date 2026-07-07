import { getApiUrlForRequest } from "@/lib/request-api-url";
import { AGENT_AUTH_EVENTS_SUPPORTED, AGENT_AUTH_SCOPES_SUPPORTED, getAgentAuthIdentityTypesSupported, getAgentAuthProjectUrls } from "@/lib/agent-auth";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

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
    const identityTypesSupported = getAgentAuthIdentityTypesSupported(tenancy.config);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        resource: urls.projectBaseUrl,
        resource_name: tenancy.project.display_name,
        resource_logo_uri: tenancy.project.logo_url ?? tenancy.project.logo_full_url ?? undefined,
        authorization_servers: [urls.projectBaseUrl],
        scopes_supported: [...AGENT_AUTH_SCOPES_SUPPORTED],
        bearer_methods_supported: ["header"],

        issuer: urls.projectBaseUrl,
        token_endpoint: urls.tokenEndpointUrl,
        revocation_endpoint: urls.revocationEndpointUrl,
        grant_types_supported: [
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "urn:workos:agent-auth:grant-type:claim",
        ],
        agent_auth: {
          skill: urls.authMdUrl,
          identity_endpoint: urls.identityEndpointUrl,
          claim_endpoint: urls.claimEndpointUrl,
          events_endpoint: urls.eventsEndpointUrl,
          identity_types_supported: identityTypesSupported,
          events_supported: [...AGENT_AUTH_EVENTS_SUPPORTED],
        },
      },
    };
  },
});
