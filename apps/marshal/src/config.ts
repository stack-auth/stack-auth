// All Marshal configuration comes from env vars — Marshal is stateless and holds no DB.
// The mock sentinel token points all Fly API URLs at the fly-mock docker service and is
// refused unless the process explicitly opts in. This must not depend on NODE_ENV: an
// omitted production NODE_ENV must fail closed.

import { assertDataEncryptionKeyIsSafe, parseDataEncryptionRootKey } from "./spec-crypto.js";

export const MOCK_FLY_TOKEN = "mock_hexclave_fly_key";

export type MarshalConfig = {
  port: number,
  apiKey: string,
  webhookSecret: string,
  dataEncryptionRootKey: Buffer,
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

export function assertMocksExplicitlyAllowed(description: string, environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.MARSHAL_ALLOW_MOCKS !== "1") {
    throw new Error(`marshal refuses to start: ${description} requires MARSHAL_ALLOW_MOCKS=1`);
  }
}

let cached: MarshalConfig | null = null;

export function getConfig(): MarshalConfig {
  if (cached) return cached;

  const flyToken = env("MARSHAL_FLY_API_TOKEN");
  const isMockFly = flyToken === MOCK_FLY_TOKEN;
  if (isMockFly) assertMocksExplicitlyAllowed("the mock Fly token");
  // The fly-mock docker service serves all three API surfaces on one port.
  const flyMockUrl = `http://localhost:${portPrefix()}48`;

  const builderKind = env("MARSHAL_BUILDER", "fly");
  if (builderKind !== "fly" && builderKind !== "mock") {
    throw new Error(`marshal refuses to start: MARSHAL_BUILDER must be "fly" or "mock" (got ${JSON.stringify(builderKind)})`);
  }
  if (builderKind === "mock") assertMocksExplicitlyAllowed("the mock builder");

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
  const dataEncryptionKey = env("HEXCLAVE_MARSHAL_DATA_ENCRYPTION_KEY");
  assertDataEncryptionKeyIsSafe(dataEncryptionKey, process.env.MARSHAL_ALLOW_MOCKS === "1");
  cached = {
    port,
    apiKey,
    webhookSecret: env("MARSHAL_WEBHOOK_SECRET", apiKey),
    dataEncryptionRootKey: parseDataEncryptionRootKey(dataEncryptionKey),
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
      // The localhost default is the dev s3mock and is only offered in mock mode: silently
      // pointing a real deployment at localhost would fail every spec, upload and build with
      // a connection error instead of saying which env var is missing.
      endpoint: env("MARSHAL_S3_ENDPOINT", isMockFly ? `http://localhost:${portPrefix()}21` : undefined),
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
// Each declared port becomes its own Fly services entry. A bound on the spec
// rather than a platform limit: a container listening on more than this is far
// likelier to be a config mistake than a real fleet.
export const MAX_PORTS_PER_SERVICE = 10;
// Fly volume bounds: 1 GB is the platform default/minimum, 500 GB the maximum.
export const MIN_VOLUME_SIZE_GB = 1;
export const MAX_VOLUME_SIZE_GB = 500;
// A Fly machine mounts at most one volume ("Currently, you may only mount one volume per
// Machine" — Machines API reference), so a second entry could not be honoured.
export const MAX_PERSISTENT_VOLUMES_PER_SERVICE = 1;
// Volume ids must survive flyVolumeName() unchanged; see VOLUME_NAME_PREFIX below.
export const VOLUME_ID_REGEX = /^[a-z][a-z0-9_]*$/;
export const MAX_VOLUME_ID_LENGTH = 26;
// One volume per service (Fly allows at most one mount per machine, and a service with a
// volume is a single-instance "server"). Fly volume names are alnum + underscore, <= 30
// chars, so the caller-chosen volume id (lowercase alnum + underscore, <= 26 — validated
// upstream) fits behind this 4-character prefix.
//
// The name is derived from the volume ID rather than being constant so a service can hold
// several distinct disks over its life and name which one it wants. The identity is NOT
// global: a Fly volume lives inside one app and the app is per-service (see naming.ts), so
// the same id under a different service is a DIFFERENT disk — ensureVolume finds no volume
// by that name in the new app and creates an empty one. Callers must not present moving an
// id between services as moving the data.
export const VOLUME_NAME_PREFIX = "hxv_";
export function flyVolumeName(volumeId: string): string {
  return `${VOLUME_NAME_PREFIX}${volumeId}`;
}
export const MACHINE_GUEST = { cpu_kind: "shared", cpus: 1, memory_mb: 512 };
export const BUILDER_GUEST = { cpu_kind: "shared", cpus: 2, memory_mb: 2048 };
// Railpack builds get a bigger machine: every builder is ephemeral (no image cache) and the
// railpack-builder base image is large — real-Fly QA measured the default guest timing out at
// 15 minutes on base-image extraction alone. The CPUs are what buy that back.
//
// The RAM has to cover TWO things at once, which is what the first sizing of it got wrong:
// the tmpfs holding buildkit's snapshot store (below) AND the build process itself. At 8g
// with a 6g tmpfs there were ~2g left, and a Next 16 app with ~1.1g of node_modules either
// filled the store (ENOSPC) or was OOM-killed at ~1.3g RSS. 16g is the ceiling for two
// performance CPUs (Fly allows 8g per CPU), and splits ~10/6 between the two.
export const RAILPACK_BUILDER_GUEST = { cpu_kind: "performance", cpus: 2, memory_mb: 16384 };
// A cap, not a reservation — unused tmpfs pages cost nothing. Sized so the store cannot fill
// before the guest's remaining ~6g is what limits the build, since ENOSPC from inside a
// buildkit step is a far more confusing failure than running out of memory.
export const RAILPACK_BUILDKIT_TMPFS_SIZE = "10g";
export const BUILDER_IMAGE = "moby/buildkit:v0.23.2";
// Railpack (https://railpack.com) builds services that don't declare a Dockerfile: the CLI
// analyzes the source and emits a build plan that its BuildKit frontend executes. CLI and
// frontend are pinned to the same release by checksum/digest (not just tags), so neither a
// re-pushed tag nor a tampered release asset can change what runs on the builder.
// FUTURE: mirror the CLI tarball and frontend image into Marshal-owned storage (the S3
// bucket / a Fly registry) so github.com/ghcr.io outages can't fail every Railpack build,
// and so each build stops re-downloading them.
export const RAILPACK_VERSION = "0.35.0";
// The builder image is Alpine-based, hence the musl build.
export const RAILPACK_CLI_URL = `https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-x86_64-unknown-linux-musl.tar.gz`;
export const RAILPACK_CLI_SHA256 = "d039785dd926ba059031c9c463c51f1462f344c844f828ac872c1f6d46fed7f1";
export const RAILPACK_FRONTEND_IMAGE = `ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}@sha256:bc73534934e7929ab3dc41765fb7e25c8c69d9be98c43ef8792fea51f65317bd`;
export const BUILD_TIMEOUT_SECONDS = 15 * 60;
export const UPLOAD_EXPIRY_SECONDS = 15 * 60;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// One part of a multipart source upload.
//
// Parts are sent and retried INDEPENDENTLY, which is the whole point: a link
// that drops a connection every few seconds cannot finish a single 30 MB PUT
// (measured: median connection life ~9s against a ~40s upload), but it finishes
// an 8 MiB part comfortably and only re-sends that part when one dies.
//
// The size has to satisfy both stores: S3 requires every part but the last to be
// at least 5 MiB, and R2 additionally requires them all to be the SAME size. A
// fixed part size with a smaller final part satisfies both by construction —
// splitting the source into N even chunks would not.
export const UPLOAD_PART_SIZE_BYTES = 8 * 1024 * 1024;
// Below this, one PUT is fewer round trips than a multipart handshake and short
// enough on the wire that re-sending it after a drop costs little.
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
// The build-completion webhook carries a status plus a small metadata document
// (an image digest at most). It is the only route reachable before the API-key
// check, so it gets an explicit cap rather than inheriting the server default.
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
export const SOFT_CONCURRENCY_LIMIT = 25;

// Build-time env (see buildTimeEnv). The values ride to the builder machine inside its
// machine CONFIG, via the files API — so they are bounded by what the Fly machine-create
// API will accept as one document, not by anything about env vars. The cap is enforced at
// spec validation so an oversized env fails the PUT with a precise message instead of
// surfacing as an opaque machine-create rejection fifteen seconds into a deploy.
export const MAX_BUILD_ENV_BYTES = 32 * 1024;
// Where the harness finds those files: one file per var, filename = var name, contents =
// the exact value.
export const BUILD_ENV_DIR = "/marshal-build-env";
// Tenant env now reaches the builder, so its values are scrubbed from build logs alongside
// Marshal's own credentials. Short values are skipped: "1", "true", "5432" and friends are
// everywhere in a build log, and redacting them would leave a page of <redacted> with no
// secret actually protected (nothing that short is a credential worth hiding).
export const MIN_REDACTED_ENV_VALUE_LENGTH = 8;
