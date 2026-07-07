export type SerializedAgentCapabilityGrant = {
  capability: string,
  status: string,
  constraints: unknown,
  expires_at: string | null,
};

export type SerializedAgent = {
  id: string,
  name: string,
  mode: string,
  status: string,
  agent_thumbprint: string,
  linked_user_id: string | null,
  host: {
    id: string,
    name: string,
    thumbprint: string,
    linked_user_id: string | null,
  },
  linked_user: { id: string, display_name: string | null } | null,
  capabilities: SerializedAgentCapabilityGrant[],
  expires_at: string,
  max_lifetime_ends_at: string,
  absolute_lifetime_ends_at: string,
  created_at: string,
  updated_at: string,
  last_used_at: string | null,
};

export function serializeAgent(agent: {
  id: string,
  name: string,
  mode: string,
  status: string,
  projectUserId: string | null,
  jwkThumbprint: string,
  expiresAt: Date,
  maxLifetimeEndsAt: Date,
  absoluteLifetimeEndsAt: Date,
  createdAt: Date,
  updatedAt: Date,
  lastUsedAt: Date | null,
  host: { id: string, name: string, jwkThumbprint: string, projectUserId: string | null },
  projectUser: { projectUserId: string, displayName: string | null } | null,
  capabilityGrants: Array<{ capability: string, status: string, constraints: unknown, expiresAt: Date | null }>,
}): SerializedAgent {
  return {
    id: agent.id,
    name: agent.name,
    mode: agent.mode === "DELEGATED" ? "delegated" : "autonomous",
    status: agent.status.toLowerCase(),
    agent_thumbprint: agent.jwkThumbprint,
    linked_user_id: agent.projectUserId,
    host: {
      id: agent.host.id,
      name: agent.host.name,
      thumbprint: agent.host.jwkThumbprint,
      linked_user_id: agent.host.projectUserId,
    },
    linked_user: agent.projectUser == null ? null : {
      id: agent.projectUser.projectUserId,
      display_name: agent.projectUser.displayName,
    },
    capabilities: agent.capabilityGrants.map((grant) => ({
      capability: grant.capability,
      status: grant.status.toLowerCase(),
      constraints: grant.constraints,
      expires_at: grant.expiresAt?.toISOString() ?? null,
    })),
    expires_at: agent.expiresAt.toISOString(),
    max_lifetime_ends_at: agent.maxLifetimeEndsAt.toISOString(),
    absolute_lifetime_ends_at: agent.absoluteLifetimeEndsAt.toISOString(),
    created_at: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString(),
    last_used_at: agent.lastUsedAt?.toISOString() ?? null,
  };
}
