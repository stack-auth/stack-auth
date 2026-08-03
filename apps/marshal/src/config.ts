// All Marshal configuration comes from env vars — Marshal is stateless and holds no DB.
// The mock sentinel token (like the backend's mock_hexclave_vercel_key pattern) points all
// Fly API URLs at the fly-mock docker service and is refused outside dev/test.

export const MOCK_FLY_TOKEN = "mock_hexclave_fly_key";

export type MarshalConfig = {
  port: number,
  apiKey: string,
  webhookSecret: string,
  // Base URL builder machines use to reach the completion webhook. Only needed for real
  // Fly builds (the mock builder completes in-process).
  publicUrl: string | null,
  envId: string,
  fly: {
    token: string,
    orgSlug: string,
    machinesApiUrl: string,
    graphqlApiUrl: string,
    logsApiUrl: string,
    registryHost: string,
    region: string,
  },
  builderKind: "fly" | "mock",
  s3: {
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    forcePathStyle: boolean,
  },
};

function env(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`marshal refuses to start: required env var ${name} is not set`);
}

function portPrefix(): string {
  return process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81";
}

// NOTE: the mock-token / mock-builder guards key off NODE_ENV === "production", matching the
// backend's vercel-client/js-execution convention. This is fail-OPEN if a real prod deploy
// forgets to set NODE_ENV=production (the guard then permits the mock token). It takes two
// mistakes (mock token set AND NODE_ENV unset) to trip, but a harder guard — deriving
// prod-ness from a Marshal-owned signal like MARSHAL_ENV_ID, or requiring an explicit
// MARSHAL_ALLOW_MOCKS=1 to permit the sentinel at all — would be strictly safer. Left aligned
// with the existing codebase convention for now; worth tightening repo-wide.
function isProductionLike(): boolean {
  return (process.env.NODE_ENV ?? "development") === "production" && process.env.MARSHAL_ALLOW_MOCKS_IN_PRODUCTION !== "1";
}

let cached: MarshalConfig | null = null;

export function getConfig(): MarshalConfig {
  if (cached) return cached;

  const flyToken = env("MARSHAL_FLY_API_TOKEN");
  const isMockFly = flyToken === MOCK_FLY_TOKEN;
  if (isMockFly && isProductionLike()) {
    throw new Error("marshal refuses to start: the mock Fly token is set in a production environment. Set MARSHAL_FLY_API_TOKEN to a real org token.");
  }
  // The fly-mock docker service serves all three API surfaces on one port.
  const flyMockUrl = `http://localhost:${portPrefix()}48`;

  const builderKind = env("MARSHAL_BUILDER", "fly");
  if (builderKind !== "fly" && builderKind !== "mock") {
    throw new Error(`marshal refuses to start: MARSHAL_BUILDER must be "fly" or "mock" (got ${JSON.stringify(builderKind)})`);
  }
  if (builderKind === "mock" && isProductionLike()) {
    throw new Error("marshal refuses to start: the mock builder is enabled in a production environment.");
  }

  const port = Number(env("MARSHAL_PORT", `${portPrefix()}47`));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`marshal refuses to start: MARSHAL_PORT must be a valid port number (got ${JSON.stringify(process.env.MARSHAL_PORT)})`);
  }

  const publicUrl = (process.env.MARSHAL_PUBLIC_URL || "").replace(/\/$/, "") || null;
  // The real builder machine calls the completion webhook on MARSHAL_PUBLIC_URL — refuse to
  // start without it rather than failing every upload-sourced build at runtime.
  if (builderKind === "fly" && publicUrl === null) {
    throw new Error("marshal refuses to start: MARSHAL_PUBLIC_URL is required when MARSHAL_BUILDER=fly (the builder machine calls the completion webhook on it).");
  }

  const apiKey = env("MARSHAL_API_KEY");
  cached = {
    port,
    apiKey,
    webhookSecret: env("MARSHAL_WEBHOOK_SECRET", apiKey),
    publicUrl,
    envId: env("MARSHAL_ENV_ID"),
    fly: {
      token: flyToken,
      orgSlug: env("MARSHAL_FLY_ORG_SLUG"),
      machinesApiUrl: env("MARSHAL_FLY_MACHINES_API_URL", isMockFly ? flyMockUrl : "https://api.machines.dev").replace(/\/$/, ""),
      graphqlApiUrl: env("MARSHAL_FLY_GRAPHQL_API_URL", isMockFly ? `${flyMockUrl}/graphql` : "https://api.fly.io/graphql"),
      logsApiUrl: env("MARSHAL_FLY_LOGS_API_URL", isMockFly ? `${flyMockUrl}/api/v1` : "https://api.fly.io/api/v1").replace(/\/$/, ""),
      registryHost: env("MARSHAL_FLY_REGISTRY_HOST", "registry.fly.io"),
      region: env("MARSHAL_FLY_REGION", "iad"),
    },
    builderKind,
    s3: {
      endpoint: env("MARSHAL_S3_ENDPOINT", `http://localhost:${portPrefix()}21`),
      region: env("MARSHAL_S3_REGION", "auto"),
      accessKeyId: env("MARSHAL_S3_ACCESS_KEY_ID"),
      secretAccessKey: env("MARSHAL_S3_SECRET_ACCESS_KEY"),
      bucket: env("MARSHAL_S3_BUCKET"),
      forcePathStyle: process.env.MARSHAL_S3_FORCE_PATH_STYLE === "1",
    },
  };
  return cached;
}

// namespace → Fly org resolution. One org per environment today; sharding namespaces
// across orgs later is a change to this function only (per the plan's decision #3).
export function resolveNamespaceOrg(_ns: string): { orgSlug: string, token: string } {
  const config = getConfig();
  return { orgSlug: config.fly.orgSlug, token: config.fly.token };
}

// Runtime policy (deliberately NOT part of the service spec or the revision hash).
export const MAX_INSTANCES_CAP = 5;
export const MACHINE_GUEST = { cpu_kind: "shared", cpus: 1, memory_mb: 512 };
export const BUILDER_GUEST = { cpu_kind: "shared", cpus: 2, memory_mb: 2048 };
export const BUILDER_IMAGE = "moby/buildkit:v0.23.2";
export const BUILD_TIMEOUT_SECONDS = 15 * 60;
export const UPLOAD_EXPIRY_SECONDS = 15 * 60;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const SOFT_CONCURRENCY_LIMIT = 25;
