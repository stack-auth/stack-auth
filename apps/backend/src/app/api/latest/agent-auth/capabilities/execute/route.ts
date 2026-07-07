import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AGENT_AUTH_SESSION_TTL_MILLIS } from "@/lib/agent-auth/constants";
import { executeAgentCapability, getAgentCapability, normalizeGrantConstraints } from "@/lib/agent-auth/capabilities";
import { getAgentAuthAudience, getAgentAuthTenancy, getBearerToken, getHeader } from "@/lib/agent-auth/requests";
import { normalizeAgentAuthPublicJwk, verifyAgentJwt } from "@/lib/agent-auth/jwt";
import { logEvent, SystemEventTypes } from "@/lib/events";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { jsonSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import * as jose from "jose";

function resolveAgentStatusError(status: string): never {
  if (status === "REVOKED" || status === "REJECTED") {
    throw new StatusError(StatusError.Forbidden, "agent_not_active");
  }
  throw new StatusError(StatusError.Forbidden, "agent_expired");
}

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    body: yupObject({
      capability: yupString().defined(),
      input: jsonSchema.optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema.defined(),
  }),
  handler: async (req, fullReq) => {
    const projectId = getHeader(fullReq, "x-stack-project-id") ?? getHeader(fullReq, "x-hexclave-project-id");
    if (!projectId) throw new StatusError(StatusError.BadRequest, "Project id is required");
    const tenancy = await getAgentAuthTenancy(projectId);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const agentJwt = getBearerToken(fullReq);
    if (!agentJwt) {
      throw new StatusError(StatusError.Unauthorized, "invalid_agent_token");
    }

    const decodedHeader = jose.decodeProtectedHeader(agentJwt);
    if (decodedHeader.typ !== "agent+jwt") {
      throw new StatusError(StatusError.Unauthorized, "invalid_agent_token");
    }

    const decodedPayload = jose.decodeJwt(agentJwt);
    const principalThumbprint = typeof decodedPayload.iss === "string" ? decodedPayload.iss : null;
    if (!principalThumbprint) {
      throw new StatusError(StatusError.Unauthorized, "invalid_agent_token");
    }

    const agent = await prisma.agent.findUnique({
      where: {
        tenancyId_jwkThumbprint: {
          tenancyId: tenancy.id,
          jwkThumbprint: principalThumbprint,
        },
      },
      include: {
        host: true,
        projectUser: true,
        capabilityGrants: true,
      },
    });
    if (!agent) {
      throw new StatusError(StatusError.Unauthorized, "agent_expired");
    }

    const agentTokenAudience = getAgentAuthAudience(fullReq.url, "/api/latest/agent-auth/capabilities/execute");
    const verified = await verifyAgentJwt({
      jwt: agentJwt,
      publicJwk: normalizeAgentAuthPublicJwk(agent.publicJwk),
      audience: agentTokenAudience,
    });
    if (verified.payload.iss !== agent.jwkThumbprint) {
      throw new StatusError(StatusError.Unauthorized, "invalid_agent_token");
    }

    const now = new Date();
    if (agent.status !== "ACTIVE") {
      resolveAgentStatusError(agent.status);
    }
    if (agent.expiresAt.getTime() <= now.getTime() || agent.maxLifetimeEndsAt.getTime() <= now.getTime() || agent.absoluteLifetimeEndsAt.getTime() <= now.getTime()) {
      await prisma.agent.update({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: agent.id,
          },
        },
        data: { status: "EXPIRED" },
      });
      throw new StatusError(StatusError.Forbidden, "agent_expired");
    }

    const grant = agent.capabilityGrants.find((candidate) => candidate.capability === req.body.capability && candidate.status === "ACTIVE");
    if (!grant) {
      throw new StatusError(StatusError.Forbidden, "capability_not_granted");
    }
    if (grant.expiresAt != null && grant.expiresAt.getTime() <= now.getTime()) {
      throw new StatusError(StatusError.Forbidden, "capability_not_granted");
    }
    if (agent.mode === "DELEGATED" && !agent.projectUser) {
      throw new StatusError(StatusError.Forbidden, "agent_not_active");
    }
    const linkedUserId = agent.projectUserId ?? (() => {
      throw new StatusError(StatusError.Forbidden, "agent_not_active");
    })();

    const capability = getAgentCapability(req.body.capability);
    const normalizedInput = req.body.input ?? {};
    const normalizedConstraints = normalizeGrantConstraints(req.body.capability, grant.constraints);
    const result = await executeAgentCapability({
      tenancy,
      capabilityName: req.body.capability,
      input: normalizedInput,
      constraints: normalizedConstraints,
    });

    const nextExpiresAt = new Date(Math.min(
      now.getTime() + AGENT_AUTH_SESSION_TTL_MILLIS,
      agent.maxLifetimeEndsAt.getTime(),
      agent.absoluteLifetimeEndsAt.getTime(),
    ));
    await prisma.agent.update({
      where: {
        tenancyId_id: {
          tenancyId: tenancy.id,
          id: agent.id,
        },
      },
      data: {
        lastUsedAt: now,
        expiresAt: nextExpiresAt,
      },
    });

    await logEvent([SystemEventTypes.AgentCapabilityExecuted], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      actor: {
        type: "agent",
        agentId: agent.id,
        hostId: agent.host.id,
        userId: linkedUserId,
      },
      agentId: agent.id,
      hostId: agent.host.id,
      capability: capability.name,
      input: normalizedInput,
      decision: "allowed",
      constraints: grant.constraints,
    }, {
      billingTeamId: null,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        capability: capability.name,
        result,
      },
    };
  },
});
