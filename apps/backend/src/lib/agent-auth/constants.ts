export const AGENT_AUTH_APP_ID = "agent-auth" as const;
export const AGENT_AUTH_PROTOCOL_VERSION = "1.0-draft" as const;
export const AGENT_AUTH_JWS_ALG = "EdDSA" as const;
export const AGENT_AUTH_JWK_CRV = "Ed25519" as const;
export const AGENT_AUTH_HOST_JWT_TYP = "host+jwt" as const;
export const AGENT_AUTH_AGENT_JWT_TYP = "agent+jwt" as const;
export const AGENT_AUTH_MODES = ["delegated"] as const;
export const AGENT_AUTH_CAPABILITY_EXECUTE_PATH = "/api/latest/agent-auth/capabilities/execute" as const;
export const AGENT_AUTH_REGISTER_PATH = "/api/latest/agent-auth/agents/register" as const;
export const AGENT_AUTH_AGENTS_PATH = "/api/latest/agent-auth/agents" as const;
export const AGENT_AUTH_DISCOVERY_PATH = "/.well-known/agent-configuration" as const;

export const AGENT_AUTH_SESSION_TTL_MILLIS = 30 * 60 * 1000;
export const AGENT_AUTH_MAX_LIFETIME_MILLIS = 24 * 60 * 60 * 1000;
export const AGENT_AUTH_ABSOLUTE_LIFETIME_MILLIS = 7 * 24 * 60 * 60 * 1000;
export const AGENT_AUTH_MAX_AGENT_JWT_SECONDS = 60;
export const AGENT_AUTH_DEFAULT_LIST_USERS_LIMIT = 25;
