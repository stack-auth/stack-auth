import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getAgentCapability, normalizeGrantConstraints } from "@/lib/agent-auth/capabilities";
import { AGENT_AUTH_ABSOLUTE_LIFETIME_MILLIS, AGENT_AUTH_MAX_LIFETIME_MILLIS, AGENT_AUTH_MODES, AGENT_AUTH_SESSION_TTL_MILLIS } from "@/lib/agent-auth/constants";
import { getAgentAuthAudience, getAgentAuthTenancy, getBearerToken, getHeader } from "@/lib/agent-auth/requests";
import { getAgentAuthJwkThumbprint, normalizeAgentAuthPublicJwk, verifyHostJwt } from "@/lib/agent-auth/jwt";
import { logEvent, SystemEventTypes } from "@/lib/events";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { jsonSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["server", "admin"]).defined(),
    }).defined(),
    body: yupObject({
      host_public_jwk: jsonSchema.defined(),
      agent_public_jwk: jsonSchema.defined(),
      host_name: yupString().defined(),
      agent_name: yupString().defined(),
      mode: yupString().oneOf([...AGENT_AUTH_MODES]).defined(),
      user_id: yupString().uuid().defined(),
      requested_capabilities: yupArray(
        yupObject({
          name: yupString().defined(),
          constraints: jsonSchema.optional(),
        }),
      ).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema.defined(),
  }),
  handler: async (req, fullReq) => {
    const projectId = getHeader(fullReq, "x-stack-project-id") ?? getHeader(fullReq, "x-hexclave-project-id");
    if (!projectId) throw new StatusError(StatusError.BadRequest, "Project id is required");
    const tenancy = await getAgentAuthTenancy(projectId);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const hostJwt = getBearerToken(fullReq);
    if (!hostJwt) throw new StatusError(StatusError.Unauthorized, "invalid_host_token");

    const hostPublicJwk = normalizeAgentAuthPublicJwk(req.body.host_public_jwk);
    const agentPublicJwk = normalizeAgentAuthPublicJwk(req.body.agent_public_jwk);
    const hostAudience = getAgentAuthAudience(fullReq.url, "/api/latest/agent-auth/agents/register");
    const verifiedHost = await verifyHostJwt({
      jwt: hostJwt,
      publicJwk: hostPublicJwk,
      audience: hostAudience,
    });
    if (verifiedHost.payload.iss !== verifiedHost.thumbprint) {
      throw new StatusError(StatusError.Unauthorized, "invalid_host_token");
    }

    const existingUser = await prisma.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: tenancy.id,
          projectUserId: req.body.user_id,
        },
      },
    });
    if (!existingUser) {
      throw new StatusError(StatusError.BadRequest, "user_not_found");
    }

    const requestedCapabilities = req.body.requested_capabilities.map((capability) => {
      const definition = getAgentCapability(capability.name);
      const constraints = normalizeGrantConstraints(capability.name, capability.constraints);
      return {
        name: definition.name,
        constraints,
      };
    });

    const now = new Date();
    const sessionExpiresAt = new Date(now.getTime() + AGENT_AUTH_SESSION_TTL_MILLIS);
    const maxLifetimeEndsAt = new Date(now.getTime() + AGENT_AUTH_MAX_LIFETIME_MILLIS);
    const absoluteLifetimeEndsAt = new Date(now.getTime() + AGENT_AUTH_ABSOLUTE_LIFETIME_MILLIS);

    const hostThumbprint = verifiedHost.thumbprint;
    const host = await prisma.agentHost.upsert({
      where: {
        tenancyId_jwkThumbprint: {
          tenancyId: tenancy.id,
          jwkThumbprint: hostThumbprint,
        },
      },
      update: {
        name: req.body.host_name,
        publicJwk: JSON.parse(JSON.stringify(hostPublicJwk)),
        status: "ACTIVE",
        projectUserId: existingUser.projectUserId,
        lastUsedAt: now,
      },
      create: {
        tenancyId: tenancy.id,
        name: req.body.host_name,
        publicJwk: JSON.parse(JSON.stringify(hostPublicJwk)),
        jwkThumbprint: hostThumbprint,
        status: "ACTIVE",
        defaultCapabilities: requestedCapabilities.map((capability) => capability.name),
        projectUserId: existingUser.projectUserId,
        lastUsedAt: now,
      },
    });

    const agentThumbprint = await getAgentAuthJwkThumbprint(agentPublicJwk);

    const agent = await prisma.agent.create({
      data: {
        tenancyId: tenancy.id,
        hostId: host.id,
        name: req.body.agent_name,
        mode: "DELEGATED",
        projectUserId: existingUser.projectUserId,
        publicJwk: JSON.parse(JSON.stringify(agentPublicJwk)),
        jwkThumbprint: agentThumbprint,
        status: "ACTIVE",
        expiresAt: sessionExpiresAt,
        maxLifetimeEndsAt,
        absoluteLifetimeEndsAt,
        lastUsedAt: now,
      },
    });

    if (requestedCapabilities.length > 0) {
      await prisma.agentCapabilityGrant.createMany({
        data: requestedCapabilities.map((capability) => ({
          tenancyId: tenancy.id,
          agentId: agent.id,
          capability: capability.name,
          status: "ACTIVE",
          constraints: capability.constraints == null ? undefined : JSON.parse(JSON.stringify(capability.constraints)),
          grantedByProjectUserId: existingUser.projectUserId,
          expiresAt: null,
        })),
      });
    }

    await logEvent([SystemEventTypes.AgentRegistered], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      actor: {
        type: "agent",
        agentId: agent.id,
        hostId: host.id,
        userId: existingUser.projectUserId,
      },
      hostId: host.id,
      agentId: agent.id,
      requestedCapabilities,
      mode: req.body.mode,
      agentName: req.body.agent_name,
      hostName: req.body.host_name,
    }, {
      billingTeamId: null,
    });

    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        host_id: host.id,
        agent_id: agent.id,
        host_thumbprint: host.jwkThumbprint,
        agent_thumbprint: agent.jwkThumbprint,
        granted_capabilities: requestedCapabilities.map((capability) => ({
          name: capability.name,
          status: "active",
          constraints: capability.constraints,
        })),
      },
    };
  },
});
