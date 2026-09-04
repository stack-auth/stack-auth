// All Marshal configuration comes from env vars — Marshal is stateless and holds no DB.
// Mock mode is refused unless the process explicitly opts in. This must not depend on
// NODE_ENV: an omitted production NODE_ENV must fail closed.

import { assertDataEncryptionKeyIsSafe, parseDataEncryptionRootKey } from "./spec-crypto.js";
import type { ServiceKind } from "./types.js";

export type MarshalConfig = {
  port: number,
  apiKey: string,
  // Vercel sets `Authorization: Bearer $CRON_SECRET` on its cron invocations. Accepted ONLY on
  // the maintenance routes, so the platform's scheduler does not have to be handed the
  // credential the backend uses for everything else. Null when unset, which is not a fallback
  // to anything: unset means Vercel sends no Authorization header and the crons cannot run.
  cronSecret: string | null,
  webhookSecret: string,
  dataEncryptionRootKey: Buffer,
  // Base URL builder VMs use to reach the completion webhook. Only needed for real builds
  // (the mock builder completes in-process).
  publicUrl: string | null,
  envId: string,
  gcp: {
    billingAccount: string,
    projectParent: string | null,
    projectPrefix: string,
    // How many fully provisioned tenant projects to keep ready for immediate assignment
    // (Google's multi-tenant recommendation). 0 disables the pool and every first deploy
    // into a namespace provisions its project synchronously.
    projectPoolSize: number,
    platformProjectId: string,
    existingProjectIdForTests: string | null,
    region: string,
    zone: string,
    network: string,
    subnetwork: string,
    mockUrl: string | null,
    mockToken: string | null,
  },
  builderKind: "gcp" | "mock",
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

export function resolveGcpMockUrl(value: string | undefined, prefix: string): string | null {
  const configured = (value || "").replace(/\/$/, "");
  return configured === "local" ? `http://localhost:${prefix}48` : configured || null;
}

let cached: MarshalConfig | null = null;

export function getConfig(): MarshalConfig {
  if (cached) return cached;

  const builderKind = env("MARSHAL_BUILDER", "gcp");
  if (builderKind !== "gcp" && builderKind !== "mock") {
    throw new Error(`marshal refuses to start: MARSHAL_BUILDER must be "gcp" or "mock" (got ${JSON.stringify(builderKind)})`);
  }
  if (builderKind === "mock") assertMocksExplicitlyAllowed("the mock builder");

  const port = Number(env("MARSHAL_PORT", `${portPrefix()}47`));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`marshal refuses to start: MARSHAL_PORT must be a valid port number (got ${JSON.stringify(process.env.MARSHAL_PORT)})`);
  }

  const publicUrlRaw = (process.env.MARSHAL_PUBLIC_URL || "").replace(/\/$/, "") || null;
  let publicUrl: string | null = null;
  if (publicUrlRaw !== null) {
    let parsed: URL;
    try {
      parsed = new URL(publicUrlRaw);
    } catch (error) {
      throw new Error(`marshal refuses to start: MARSHAL_PUBLIC_URL must be an absolute URL (got ${JSON.stringify(publicUrlRaw)})`, { cause: error });
    }
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.pathname !== "/") {
      throw new Error("marshal refuses to start: MARSHAL_PUBLIC_URL must contain only an origin, without credentials, a path, query params, or a fragment");
    }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && process.env.MARSHAL_ALLOW_MOCKS === "1")) {
      throw new Error("marshal refuses to start: MARSHAL_PUBLIC_URL must use HTTPS (HTTP is allowed only with MARSHAL_ALLOW_MOCKS=1)");
    }
    publicUrl = parsed.origin;
  }
  // The real builder machine calls the completion webhook on MARSHAL_PUBLIC_URL — refuse to
  // start without it rather than failing every upload-sourced build at runtime.
  if (builderKind === "gcp" && publicUrl === null) {
    throw new Error("marshal refuses to start: MARSHAL_PUBLIC_URL is required when MARSHAL_BUILDER=gcp (the builder VM calls the completion webhook on it).");
  }

  const existingProjectIdForTests = (process.env.HEXCLAVE_MARSHAL_GCP_EXISTING_PROJECT_ID_FOR_TESTS || "").trim() || null;
  if (existingProjectIdForTests !== null) assertMocksExplicitlyAllowed("HEXCLAVE_MARSHAL_GCP_EXISTING_PROJECT_ID_FOR_TESTS");
  const gcpMockUrl = resolveGcpMockUrl(process.env.HEXCLAVE_MARSHAL_GCP_MOCK_URL, portPrefix());
  if (gcpMockUrl !== null) assertMocksExplicitlyAllowed("HEXCLAVE_MARSHAL_GCP_MOCK_URL");
  const projectPoolSizeRaw = process.env.HEXCLAVE_MARSHAL_GCP_PROJECT_POOL_SIZE || "0";
  const projectPoolSize = Number(projectPoolSizeRaw);
  if (!Number.isInteger(projectPoolSize) || projectPoolSize < 0 || projectPoolSize > 100) {
    throw new Error(`marshal refuses to start: HEXCLAVE_MARSHAL_GCP_PROJECT_POOL_SIZE must be an integer between 0 and 100 (got ${JSON.stringify(projectPoolSizeRaw)})`);
  }
  const region = env("HEXCLAVE_MARSHAL_GCP_REGION", "us-central1");
  const zone = env("HEXCLAVE_MARSHAL_GCP_ZONE", `${region}-a`);

  const apiKey = env("MARSHAL_API_KEY");
  const dataEncryptionKey = env("HEXCLAVE_MARSHAL_DATA_ENCRYPTION_KEY");
  assertDataEncryptionKeyIsSafe(dataEncryptionKey, process.env.MARSHAL_ALLOW_MOCKS === "1");
  cached = {
    port,
    apiKey,
    cronSecret: process.env.CRON_SECRET || null,
    webhookSecret: env("MARSHAL_WEBHOOK_SECRET", apiKey),
    dataEncryptionRootKey: parseDataEncryptionRootKey(dataEncryptionKey),
    publicUrl,
    envId: env("MARSHAL_ENV_ID"),
    gcp: {
      billingAccount: env("HEXCLAVE_MARSHAL_GCP_BILLING_ACCOUNT", existingProjectIdForTests === null ? undefined : "test-only"),
      projectParent: (process.env.HEXCLAVE_MARSHAL_GCP_PROJECT_PARENT || "").replace(/^\/+|\/+$/g, "") || null,
      projectPrefix: env("HEXCLAVE_MARSHAL_GCP_PROJECT_PREFIX", "hxc-tenant"),
      projectPoolSize,
      platformProjectId: env("HEXCLAVE_MARSHAL_GCP_PLATFORM_PROJECT_ID"),
      existingProjectIdForTests,
      region,
      zone,
      network: env("HEXCLAVE_MARSHAL_GCP_NETWORK", "hexclave-runtime"),
      subnetwork: env("HEXCLAVE_MARSHAL_GCP_SUBNETWORK", "hexclave-runtime"),
      mockUrl: gcpMockUrl,
      mockToken: gcpMockUrl === null ? null : env("HEXCLAVE_MARSHAL_GCP_MOCK_TOKEN", "mock_hexclave_gcp_key"),
    },
    builderKind,
    s3: {
      // The localhost default is the dev s3mock and is only offered in mock mode: silently
      // pointing a real deployment at localhost would fail every spec, upload and build with
      // a connection error instead of saying which env var is missing.
      endpoint: env("MARSHAL_S3_ENDPOINT", builderKind === "mock" ? `http://localhost:${portPrefix()}21` : undefined),
      region: env("MARSHAL_S3_REGION", "auto"),
      accessKeyId: env("MARSHAL_S3_ACCESS_KEY_ID"),
      secretAccessKey: env("MARSHAL_S3_SECRET_ACCESS_KEY"),
      bucket: env("MARSHAL_S3_BUCKET"),
      forcePathStyle: process.env.MARSHAL_S3_FORCE_PATH_STYLE === "1",
    },
  };
  return cached;
}

// Runtime policy (deliberately NOT part of the service spec or the revision hash).
export const MAX_INSTANCES_CAP = 5;
// A bound on the spec rather than a platform limit: a container listening on more than this is far
// likelier to be a config mistake than a real fleet.
export const MAX_PORTS_PER_SERVICE = 10;
// Persistent Disk bounds. Disks are grow-only and survive server deletion.
export const MIN_VOLUME_SIZE_GB = 1;
export const MAX_VOLUME_SIZE_GB = 500;
// A server deliberately supports one persistent disk to preserve the v1 service contract.
export const MAX_PERSISTENT_VOLUMES_PER_SERVICE = 1;
// Volume ids must survive gcpDiskName() unchanged; see VOLUME_NAME_PREFIX below.
export const VOLUME_ID_REGEX = /^[a-z][a-z0-9_]*$/;
export const MAX_VOLUME_ID_LENGTH = 26;
// The name is derived from service identity and volume id in naming.ts. Underscores are
// normalized because Compute Engine resource names only allow lowercase letters, digits,
// and hyphens.
export const VOLUME_NAME_PREFIX = "hxv_";
export function gcpDiskName(volumeId: string): string {
  return `${VOLUME_NAME_PREFIX}${volumeId}`.replace(/_/g, "-");
}

// ---------------------------------------------------------------------------
// Compute sizing.
//
// Callers name MEMORY and nothing else; everything below is derived here. That
// is not a simplification of a richer contract — it is the only shape that can
// be honoured, because neither runtime accepts free choice: a "server" is a
// Compute Engine instance and must be one of a fixed catalog of machine types,
// and a Cloud Run container's CPU and memory come in legal PAIRS (past 4 GiB a
// single CPU is not an allowed combination). A caller-supplied CPU could ask for
// something no provider will take, and the 400 would arrive after the caller's
// upload had already been consumed.
//
// These tables are the runtime half of the ladder in @hexclave/shared's
// deployments.ts. KEPT IN SYNC WITH IT — the backend refuses a size that is not
// on its copy, and this one refuses a size that is not on ours, exactly as
// validateServiceSpec re-validates every other part of a spec rather than
// trusting the boundary above it.

// The machine shape a "server" of each size runs on.
//
// The three smallest are SHARED-CORE: e2-micro is 0.25 vCPU sustained (burstable
// to 2), e2-small 0.5, e2-medium 1. e2-standard-2 is the first with dedicated
// cores. So a memory change is also a CPU change, which is why the sizes are
// coarse and why every surface that shows one shows the CPU beside it.
export const SERVER_MACHINE_TYPE_BY_MEMORY_MB: Partial<Record<number, string>> = {
  1024: "e2-micro",
  2048: "e2-small",
  4096: "e2-medium",
  8192: "e2-standard-2",
};
// What a "serverless" container of each size gets. Every pair here is one Cloud
// Run accepts; the table exists so an invalid pair is unrepresentable rather
// than validated.
export const SERVERLESS_CPU_BY_MEMORY_MB: Partial<Record<number, number>> = {
  512: 1,
  1024: 1,
  2048: 1,
  4096: 2,
  8192: 4,
};
// What a service runs at when its spec names no size. Absent MUST mean exactly
// this, in both directions: the backend omits the field rather than restating
// the default precisely so that a spec which changes nothing hashes to the same
// revision — and for a "server" a changed revision means the VM is replaced.
export const DEFAULT_SERVER_MEMORY_MB = 1024;
export const DEFAULT_SERVERLESS_MEMORY_MB = 512;

/**
 * The machine shape a server of this size runs on.
 *
 * Throws rather than falling back, and the callers are why: validateServiceSpec
 * refuses any size that is not a key here, so reaching this means a STORED spec
 * (replayed on every reconcile) named a size this Marshal does not know — and
 * creating an instance with no machine type would be a worse outcome than
 * failing the apply.
 */
export function serverMachineTypeFor(memoryMb: number): string {
  const machineType = SERVER_MACHINE_TYPE_BY_MEMORY_MB[memoryMb];
  if (machineType === undefined) throw new Error(`no server machine shape for ${memoryMb}MB`);
  return machineType;
}

/** The CPU a serverless container of this size gets. Throws for the same reason. */
export function serverlessCpuFor(memoryMb: number): number {
  const cpu = SERVERLESS_CPU_BY_MEMORY_MB[memoryMb];
  if (cpu === undefined) throw new Error(`no container CPU for ${memoryMb}MB`);
  return cpu;
}

/** The memory a spec asks for, or its type's default. */
export function serviceMemoryMb(spec: { config: { type: ServiceKind, memory_mb?: number } }): number {
  return spec.config.memory_mb ?? (spec.config.type === "server" ? DEFAULT_SERVER_MEMORY_MB : DEFAULT_SERVERLESS_MEMORY_MB);
}

// The builder machine for one deployment, by requested memory. Disk grows with
// it: a build big enough to need 32g of RAM is pulling and unpacking more
// layers too, and ENOSPC on the boot disk is the same failure as ENOSPC in the
// snapshot store, from a different direction.
export const BUILDER_MACHINE_BY_MEMORY_MB: Partial<Record<number, { machineType: string, diskSizeGb: number }>> = {
  8192: { machineType: "e2-standard-2", diskSizeGb: 30 },
  16384: { machineType: "e2-standard-4", diskSizeGb: 50 },
  32768: { machineType: "e2-standard-8", diskSizeGb: 100 },
};
export const DEFAULT_BUILDER_MEMORY_MB = 8192;
// The FLOOR for a Railpack build, not its default: a request for less is raised
// to this rather than refused.
//
// Every builder is ephemeral (no image cache) and the railpack-builder base
// image is large, so a small machine can spend its entire 15 minutes on
// base-image extraction alone — the CPUs that come with the larger shape are
// what buy that back. The RAM has to cover TWO things at once, which is what the
// first sizing of this got wrong: the tmpfs holding buildkit's snapshot store
// AND the build process itself. At 8g with a 6g tmpfs there were ~2g left, and a
// Next 16 app with ~1.1g of node_modules either filled the store (ENOSPC) or was
// OOM-killed at ~1.3g RSS.
export const RAILPACK_MIN_BUILDER_MEMORY_MB = 16384;

/**
 * The builder machine for a deployment: what was asked for, floored at what the
 * build shape needs, and defaulted when nothing was asked.
 *
 * A request BELOW the floor is raised rather than refused. The floor is a fact
 * about how much machine this kind of build takes, not an entitlement, and
 * failing a deploy because the author asked for a machine that merely would not
 * have worked is worse than quietly giving them one that does.
 */
export function builderMachineFor(options: { requestedMemoryMb: number | null, isRailpackBuild: boolean }): { machineType: string, diskSizeGb: number, memoryMb: number } {
  const floor = options.isRailpackBuild ? RAILPACK_MIN_BUILDER_MEMORY_MB : DEFAULT_BUILDER_MEMORY_MB;
  const memoryMb = Math.max(options.requestedMemoryMb ?? floor, floor);
  const machine = BUILDER_MACHINE_BY_MEMORY_MB[memoryMb];
  if (machine === undefined) throw new Error(`no builder machine shape for ${memoryMb}MB`);
  return { ...machine, memoryMb };
}

/**
 * The BuildKit snapshot-store tmpfs for a builder of this size.
 *
 * A cap, not a reservation — unused tmpfs pages cost nothing. It has to SCALE
 * with the machine in both directions: fixed at 10g, a 32g builder would gain
 * nothing at all from its extra memory (the store, not the build, is what runs
 * out first on a large dependency tree), and an 8g one would have almost nothing
 * left for the build itself.
 *
 * ~60%, which is roughly the 10/6 split that a 16g Railpack builder was verified
 * to survive on: enough store that ENOSPC is not what a build hits first, since
 * running out of space inside a buildkit step is a far more confusing failure
 * than running out of memory.
 */
export function buildkitTmpfsSize(memoryMb: number): string {
  return `${Math.max(1, Math.floor((memoryMb * 6) / 10 / 1024))}g`;
}

export const BUILDER_IMAGE = "docker.io/moby/buildkit:v0.23.2@sha256:ddd1ca44b21eda906e81ab14a3d467fa6c39cd73b9a39df1196210edcb8db59e";
// Railpack (https://railpack.com) builds services that don't declare a Dockerfile: the CLI
// analyzes the source and emits a build plan that its BuildKit frontend executes. CLI and
// frontend are pinned to the same release by checksum/digest (not just tags), so neither a
// re-pushed tag nor a tampered release asset can change what runs on the builder.
// FUTURE: mirror the CLI tarball and frontend image into Marshal-owned storage (the S3
// bucket / Artifact Registry) so github.com/ghcr.io outages can't fail every Railpack build,
// and so each build stops re-downloading them.
export const RAILPACK_VERSION = "0.35.0";
// The builder image is Alpine-based, hence the musl build.
export const RAILPACK_CLI_URL = `https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-x86_64-unknown-linux-musl.tar.gz`;
export const RAILPACK_CLI_SHA256 = "d039785dd926ba059031c9c463c51f1462f344c844f828ac872c1f6d46fed7f1";
export const RAILPACK_FRONTEND_IMAGE = `ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}@sha256:bc73534934e7929ab3dc41765fb7e25c8c69d9be98c43ef8792fea51f65317bd`;
// The base image a service is built on when it names a `build_command` but no
// image and no Dockerfile — the one shape where the author has said how to build
// and run but not what to start from.
//
// A stock upstream image rather than one Hexclave publishes: it is already
// mirrored, already patched on a schedule somebody else keeps, and needs no
// release pipeline of ours to stay current. The full (non-slim) Debian variant
// on purpose — it carries git, curl, python3 and a C toolchain, which is what
// makes an arbitrary `npm install` with native modules work — and node/npm come
// with it, with pnpm and yarn a `corepack enable` away in the image itself.
//
// Pinned by DIGEST as well as tag, like RAILPACK_FRONTEND_IMAGE: a moved tag
// must not silently change what every base-image build starts from. The tag is
// kept alongside it for readability; the digest is what is pulled.
//
// The cost of this path is that the build image IS the runtime image (there is
// no stage to discard), so a service built this way pulls the whole toolchain on
// every cold start. A Dockerfile is the answer for anything that minds.
export const BASE_IMAGE = "docker.io/library/node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d";
// Where the upload is copied to in a generated Dockerfile, and the root that a
// target's `root_directory` is resolved against for its build command.
export const BASE_IMAGE_WORKDIR = "/app";
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
// VM metadata through the file bundle, so they are bounded by what the instance-create
// API will accept as one document, not by anything about env vars. The cap is enforced at
// spec validation so an oversized env fails the PUT with a precise message instead of
// surfacing as an opaque machine-create rejection fifteen seconds into a deploy.
export const MAX_BUILD_ENV_BYTES = 32 * 1024;
// Where the harness finds those files: one file per var, filename = var name, contents =
// the exact value.
export const BUILD_ENV_DIR = "/marshal-build-env";
// Tenant env reaches the builder, so its values are scrubbed from build logs alongside
// Marshal's own credentials. Short values are skipped: "1", "true", "5432" and friends are
// everywhere in a build log, and redacting them would leave a page of <redacted> with no
// secret actually protected (nothing that short is a credential worth hiding).
export const MIN_REDACTED_ENV_VALUE_LENGTH = 8;
// The one family of env vars that is NOT scrubbed. These carry the commit a deploy shipped
// (CI_COMMIT_SHA and friends), which is provenance rather than a credential — and scrubbing
// it does active damage: the values are matched as plain substrings, so an 8-hex short sha
// blacks out every unrelated 8-hex run in the log (image digests, BuildKit layer ids) as
// well as the places the build legitimately prints its own revision. The control plane only
// ever admits this namespace for that field, so nothing sensitive can enter through it.
export const UNREDACTED_ENV_KEY_REGEX = /^CI_[A-Z0-9_]+$/;
// Where Marshal-generated Dockerfiles (and Dockerfile suffixes) are injected on
// the builder machine, one directory per target. Kept out of the build CONTEXT
// (/ctx, the extracted upload) on purpose: a file placed there would be part of
// every `COPY . .` the author writes.
export const BUILD_DOCKERFILE_DIR = "/marshal-dockerfiles";
// The cap on a build or start command, stated here for Marshal and in
// @hexclave/shared's MAX_DEPLOYMENT_COMMAND_LENGTH for everything upstream of
// it. Both must agree: a command the runtime would refuse has to fail at sync
// time, before an upload has been consumed.
export const MAX_COMMAND_LENGTH = 2048;
