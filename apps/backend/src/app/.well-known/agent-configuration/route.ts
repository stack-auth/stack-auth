import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, jsonSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { AGENT_AUTH_AGENTS_PATH, AGENT_AUTH_CAPABILITY_EXECUTE_PATH, AGENT_AUTH_DISCOVERY_PATH, AGENT_AUTH_MODES, AGENT_AUTH_PROTOCOL_VERSION, AGENT_AUTH_REGISTER_PATH } from "@/lib/agent-auth/constants";
import { AGENT_CAPABILITIES } from "@/lib/agent-auth/capabilities";
import { getAgentAuthTenancy, getHeader } from "@/lib/agent-auth/requests";

function buildDiscoveryUrl(baseUrl: string, path: string) {
  return new URL(path, new URL(baseUrl).origin).toString();
}

export const GET = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema,
      project: adaptSchema,
    }).nullable(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema.defined(),
  }),
  handler: async (_req, fullReq) => {
    const projectId = getHeader(fullReq, "x-stack-project-id") ?? getHeader(fullReq, "x-hexclave-project-id");
    if (!projectId) {
      throw new StatusError(StatusError.BadRequest, "Project id is required");
    }
    await getAgentAuthTenancy(projectId);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        version: AGENT_AUTH_PROTOCOL_VERSION,
        provider: new URL(fullReq.url).origin,
        issuer: new URL(fullReq.url).origin,
        algorithms: ["Ed25519"],
        modes: [...AGENT_AUTH_MODES],
        endpoints: {
          discovery: buildDiscoveryUrl(fullReq.url, AGENT_AUTH_DISCOVERY_PATH),
          register: buildDiscoveryUrl(fullReq.url, AGENT_AUTH_REGISTER_PATH),
          agents: buildDiscoveryUrl(fullReq.url, AGENT_AUTH_AGENTS_PATH),
          execute: buildDiscoveryUrl(fullReq.url, AGENT_AUTH_CAPABILITY_EXECUTE_PATH),
        },
        capabilities: Object.values(AGENT_CAPABILITIES).map((capability) => ({
          name: capability.name,
          description: capability.description,
        })),
      },
    };
  },
});
