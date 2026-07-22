// Core logic for the Deployments app: service definitions (from the branch
// config) + operational state (Prisma) + the Vercel write-through.
//
// Terminology, because it's easy to mix up:
// - "service id" is the user-facing key under `deployments.services` in the
//   config (e.g. "api"). It's what the CLI and all API routes use.
// - The DeploymentService Prisma row is purely operational (Vercel project id,
//   last-deployed build config, env vars, runs) and is created lazily.

import { getBranchConfigOverrideSource, overrideBranchConfigOverride } from "@/lib/config";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction, globalPrismaClient } from "@/prisma-client";
import type { DeploymentRunStatus, Prisma } from "@/generated/prisma/client";
import { CompleteConfig } from "@hexclave/shared/dist/config/schema";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { filterUndefined } from "@hexclave/shared/dist/utils/objects";
import { parseTar } from "@hexclave/shared/dist/utils/tar";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { VercelDeploymentsClient, VercelApiError, VercelDeploymentFile, getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull, sanitizeVercelError } from "./vercel-client";

export type DeploymentServiceDefinition = CompleteConfig["deployments"]["services"][string];

// Sizes are generous for "source of a web app without node_modules" while
// still bounding what a hostile upload can make the backend allocate.
const MAX_TARBALL_GZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_TARBALL_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 20_000;
export const UPLOAD_EXPIRY_MS = 15 * 60 * 1000;

export const MAX_UPLOAD_BYTES = MAX_TARBALL_GZIPPED_BYTES;

// Matches the reference syntax used by the dashboard's Variables tab:
// `{serviceId.outputKey}` inside an env var value.
const REFERENCE_REGEX = /\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\}/g;

export const ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The managed Hexclave service occupies this service id on the board; a config
// entry must never shadow it.
export const HEXCLAVE_SERVICE_ID = "hexclave";

export function listServiceDefinitions(tenancy: Tenancy): Map<string, DeploymentServiceDefinition> {
  return new Map(Object.entries(tenancy.config.deployments.services));
}

export function getServiceDefinitionOrThrow(tenancy: Tenancy, serviceId: string): DeploymentServiceDefinition {
  const definition = listServiceDefinitions(tenancy).get(serviceId);
  if (definition == null) {
    throw new StatusError(404, `No deployment service with id ${JSON.stringify(serviceId)} exists in this project's configuration. ${describeConfigSourceHint(serviceId)}`);
  }
  return definition;
}

function describeConfigSourceHint(serviceId: string): string {
  return `Add a \`deployments.services.${serviceId}\` entry to the project configuration (in the dashboard, or in your hexclave.config.ts if the project's config is pushed from a config file or GitHub).`;
}

/**
 * Throws a clean 400 when the project's service definitions can't be edited
 * through this API because the config is pushed from a config file or GitHub.
 * (Deploy-time env vars are unaffected — only definitions live in the config.)
 */
export async function assertServiceDefinitionsEditable(tenancy: Tenancy): Promise<void> {
  const source = await getBranchConfigOverrideSource({
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
  });
  if (source.type !== "unlinked") {
    const sourceDescription = source.type === "pushed-from-github" ? "GitHub" : "a config file pushed via the CLI";
    throw new StatusError(400, `This project's configuration is managed by ${sourceDescription}, so deployment services can't be edited here. Edit the \`deployments.services\` section of your hexclave.config.ts instead.`);
  }
}

export async function updateServiceDefinitionInConfig(tenancy: Tenancy, serviceId: string, definition: Partial<{
  framework: string | null,
  installCommand: string | null,
  buildCommand: string | null,
  outputDirectory: string | null,
  rootDirectory: string | null,
}>): Promise<void> {
  const configOverrideOverride = Object.fromEntries(
    Object.entries(filterUndefined(definition))
      .map(([key, value]) => [`deployments.services.${serviceId}.${key}`, value]),
  );
  if (Object.keys(configOverrideOverride).length === 0) return;
  await overrideBranchConfigOverride({
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
    branchConfigOverrideOverride: configOverrideOverride,
  });
}

export async function createServiceDefinitionInConfig(tenancy: Tenancy, serviceId: string, definition: {
  framework?: string,
  installCommand?: string,
  buildCommand?: string,
  outputDirectory?: string,
  rootDirectory?: string,
}): Promise<void> {
  await overrideBranchConfigOverride({
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
    branchConfigOverrideOverride: {
      [`deployments.services.${serviceId}`]: {
        ...definition.framework != null ? { framework: definition.framework } : {},
        ...definition.installCommand != null ? { installCommand: definition.installCommand } : {},
        ...definition.buildCommand != null ? { buildCommand: definition.buildCommand } : {},
        ...definition.outputDirectory != null ? { outputDirectory: definition.outputDirectory } : {},
        ...definition.rootDirectory != null ? { rootDirectory: definition.rootDirectory } : {},
      },
    },
  });
}

export async function deleteServiceDefinitionFromConfig(tenancy: Tenancy, serviceId: string): Promise<void> {
  await overrideBranchConfigOverride({
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
    branchConfigOverrideOverride: {
      [`deployments.services.${serviceId}`]: null,
    },
  });
}

// Bare hostname (no scheme/path/port), at least two labels. Shared by every
// path that accepts a hostname (interactive domain add + deploy build_config)
// so validation can't drift between them again.
export const HOSTNAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Lowercases and validates a user-supplied hostname, or throws a clean 400. */
export function normalizeHostnameOrThrow(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  if (!HOSTNAME_REGEX.test(normalized)) {
    throw new StatusError(400, `Invalid domain hostname ${JSON.stringify(hostname)} — must be a bare hostname like app.example.com, not a URL.`);
  }
  return normalized;
}

/**
 * Turns a hostname into a config record key. Config keys can't contain dots,
 * so the readable part replaces them with hyphens; the hash suffix keeps the
 * mapping INJECTIVE (e.g. `a.b.com` vs `a-b.com` must not share a key, or one
 * would silently overwrite the other in the config record) and caps the key
 * within the 63-char id limit for arbitrarily long hostnames. Deterministic on
 * purpose: the same hostname always maps to the same key, which makes domain
 * upserts idempotent.
 */
export function domainKeyForHostname(hostname: string): string {
  const normalized = normalizeHostnameOrThrow(hostname);
  const readable = normalized.replace(/[^a-z0-9_-]/g, "-").replace(/^-+/, "").slice(0, 50).replace(/-+$/, "");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${readable}-${hash}`;
}

export async function getOrCreateOperationalService(prisma: PrismaClientTransaction, tenancy: Tenancy, serviceId: string) {
  return await prisma.deploymentService.upsert({
    where: {
      tenancyId_serviceId: {
        tenancyId: tenancy.id,
        serviceId,
      },
    },
    update: {},
    create: {
      tenancyId: tenancy.id,
      serviceId,
    },
  });
}

/**
 * The Vercel project name for a service: `hxc-<hexclaveProjectId>-<serviceId>`,
 * sanitized to Vercel's project name rules (lowercase alphanumeric + hyphens,
 * max 100 chars). Only used at provisioning time — afterwards the persisted
 * Vercel project id is authoritative, so truncation collisions surface as a
 * name-conflict error on creation rather than silent cross-linking.
 */
export function vercelProjectNameForService(hexclaveProjectId: string, serviceId: string): string {
  const sanitized = `hxc-${hexclaveProjectId}-${serviceId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, 100).replace(/-+$/, "");
}

// Vercel only accepts known framework slugs; everything else must be omitted
// (Vercel then auto-detects). The dashboard's framework field is free-form, so
// map the common spellings and drop the rest.
const FRAMEWORK_SLUGS = new Map<string, string>([
  ["nextjs", "nextjs"],
  ["next.js", "nextjs"],
  ["next", "nextjs"],
  ["vite", "vite"],
  ["astro", "astro"],
  ["remix", "remix"],
  ["sveltekit", "sveltekit"],
  ["svelte", "sveltekit"],
  ["nuxt", "nuxtjs"],
  ["nuxtjs", "nuxtjs"],
  ["gatsby", "gatsby"],
  ["create-react-app", "create-react-app"],
]);

export function frameworkSlugOrUndefined(framework: string | undefined): string | undefined {
  if (framework == null || framework.trim() === "") return undefined;
  return FRAMEWORK_SLUGS.get(framework.trim().toLowerCase());
}

export function mapVercelReadyState(readyState: string): DeploymentRunStatus {
  switch (readyState) {
    case "QUEUED": {
      return "QUEUED";
    }
    case "BUILDING":
    case "INITIALIZING":
    case "UPLOADING": {
      return "BUILDING";
    }
    case "READY": {
      return "READY";
    }
    case "ERROR": {
      return "ERROR";
    }
    case "CANCELED": {
      return "CANCELED";
    }
    default: {
      // Vercel added a state we don't know; treat it as still-building so
      // polling continues instead of wrongly finalizing the run.
      return "BUILDING";
    }
  }
}

export function isTerminalRunStatus(status: DeploymentRunStatus): boolean {
  return status === "READY" || status === "ERROR" || status === "CANCELED";
}

export type ResolvedEnvVars = {
  resolved: { key: string, value: string }[],
  // Every resolved value that came from a secret output; used to redact log
  // streams as defense-in-depth.
  secretValues: string[],
};

/**
 * Resolves `{serviceId.outputKey}` references server-side. Supported outputs:
 * - `{hexclave.projectId|apiUrl|jwksUrl|publishableClientKey|secretServerKey}`
 *   from the managed Hexclave service, and
 * - `{<serviceId>.url|previewUrl}` from other deployment services.
 * Error messages only ever contain the reference token itself (a pointer),
 * never any resolved value.
 */
export async function resolveEnvVars(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  envVars: { key: string, value: string }[],
}): Promise<ResolvedEnvVars> {
  const { tenancy, prisma, envVars } = options;
  const definitions = listServiceDefinitions(tenancy);
  const secretValues: string[] = [];

  // Cache per-service/per-output resolution so N references to the same output
  // don't repeat DB queries.
  const outputCache = new Map<string, Promise<{ value: string, secret: boolean }>>();
  const resolveOutput = (serviceId: string, outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> => {
    const cacheKey = `${serviceId}\0${outputKey}`;
    const cached = outputCache.get(cacheKey);
    if (cached != null) return cached;
    const promise = (async () => {
      if (serviceId === HEXCLAVE_SERVICE_ID) {
        return await resolveHexclaveOutput(tenancy, outputKey, raw);
      }
      if (!definitions.has(serviceId)) {
        throw new StatusError(400, `Env var reference ${raw} points to a service that doesn't exist in this project's configuration.`);
      }
      return await resolveServiceOutput(prisma, tenancy, serviceId, outputKey, raw);
    })();
    outputCache.set(cacheKey, promise);
    return promise;
  };

  const resolved = await Promise.all(envVars.map(async (envVar) => {
    if (!ENV_VAR_KEY_REGEX.test(envVar.key)) {
      throw new StatusError(400, `Invalid env var key: ${JSON.stringify(envVar.key)}. Keys must match ${ENV_VAR_KEY_REGEX.toString()}.`);
    }
    const matches = [...envVar.value.matchAll(REFERENCE_REGEX)];
    let value = envVar.value;
    for (const match of matches) {
      const output = await resolveOutput(match[1], match[2], match[0]);
      // Function replacer: a plain string replacement would interpret `$&`,
      // `$'` etc. inside the resolved value (secrets can contain `$`).
      value = value.replace(match[0], () => output.value);
      if (output.secret) {
        secretValues.push(output.value);
      }
    }
    return { key: envVar.key, value };
  }));

  return { resolved, secretValues };
}

async function resolveHexclaveOutput(tenancy: Tenancy, outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> {
  const apiUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  switch (outputKey) {
    case "projectId": {
      return { value: tenancy.project.id, secret: false };
    }
    case "apiUrl": {
      return { value: apiUrl, secret: false };
    }
    case "jwksUrl": {
      return { value: `${apiUrl.replace(/\/$/, "")}/api/v1/projects/${tenancy.project.id}/.well-known/jwks.json`, secret: false };
    }
    case "publishableClientKey":
    case "secretServerKey": {
      const keySet = await globalPrismaClient.apiKeySet.findFirst({
        where: {
          projectId: tenancy.project.id,
          manuallyRevokedAt: null,
          expiresAt: { gt: new Date() },
          ...(outputKey === "publishableClientKey" ? { publishableClientKey: { not: null } } : { secretServerKey: { not: null } }),
        },
        orderBy: { createdAt: "desc" },
      });
      if (keySet == null) {
        throw new StatusError(400, `Env var reference ${raw} can't be resolved because the project has no active API key of that kind. Create one in the dashboard under "API Keys" first.`);
      }
      if (outputKey === "publishableClientKey") {
        return { value: keySet.publishableClientKey ?? throwErr("publishableClientKey is null despite filter; this should never happen"), secret: false };
      }
      return { value: keySet.secretServerKey ?? throwErr("secretServerKey is null despite filter; this should never happen"), secret: true };
    }
    default: {
      throw new StatusError(400, `Env var reference ${raw} uses an unknown output. The hexclave service exposes: projectId, apiUrl, jwksUrl, publishableClientKey, secretServerKey.`);
    }
  }
}

async function resolveServiceOutput(prisma: PrismaClientTransaction, tenancy: Tenancy, serviceId: string, outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> {
  if (outputKey !== "url" && outputKey !== "previewUrl") {
    throw new StatusError(400, `Env var reference ${raw} uses an unknown output. Deployment services expose: url, previewUrl.`);
  }
  const service = await prisma.deploymentService.findUnique({
    where: {
      tenancyId_serviceId: {
        tenancyId: tenancy.id,
        serviceId,
      },
    },
    include: {
      domains: true,
    },
  });
  if (outputKey === "url") {
    const primaryDomain = service?.domains.find((d) => d.isPrimary && d.verified) ?? service?.domains.find((d) => d.verified);
    if (primaryDomain != null) {
      return { value: `https://${primaryDomain.hostname}`, secret: false };
    }
  }
  const latestReadyRun = service == null ? null : await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: service.id,
      status: "READY",
      target: outputKey === "url" ? "production" : "preview",
      vercelDeploymentUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });
  if (latestReadyRun?.vercelDeploymentUrl == null) {
    throw new StatusError(400, `Env var reference ${raw} can't be resolved because the service ${JSON.stringify(serviceId)} has no successful ${outputKey === "url" ? "production" : "preview"} deployment yet. Deploy it first.`);
  }
  return { value: `https://${latestReadyRun.vercelDeploymentUrl}`, secret: false };
}

/**
 * Everything we know to be secret for a service's log streams: literal values
 * of is_secret dashboard vars, resolved values of secret outputs, and — independently
 * of any env var — every secret API key of the project itself. The last one
 * matters for CLI deploys: --env values are not persisted anywhere, so a
 * `{hexclave.secretServerKey}` reference passed at deploy time can't be
 * re-derived from stored env vars, but the underlying key values can. (Literal
 * secrets passed via --env that Hexclave has never seen can't be redacted;
 * they are the caller's own values.)
 */
export async function collectLogRedactionSecrets(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  serviceEnvVars: { key: string, value: string, isSecret: boolean }[],
}): Promise<string[]> {
  const { prisma, tenancy, serviceEnvVars } = options;
  const secretValues: string[] = serviceEnvVars.filter((envVar) => envVar.isSecret).map((envVar) => envVar.value);
  const apiKeySets = await globalPrismaClient.apiKeySet.findMany({
    where: { projectId: tenancy.project.id },
    select: { secretServerKey: true, superSecretAdminKey: true },
  });
  for (const keySet of apiKeySets) {
    if (keySet.secretServerKey != null) secretValues.push(keySet.secretServerKey);
    if (keySet.superSecretAdminKey != null) secretValues.push(keySet.superSecretAdminKey);
  }
  // Resolve var-by-var: a single unresolvable reference (e.g. a referenced
  // service was deleted since) must not disable redaction for every OTHER
  // resolved secret. The failed var's own reference was never pushed as
  // plaintext anyway, so skipping just it is safe.
  for (const envVar of serviceEnvVars) {
    try {
      const resolved = await resolveEnvVars({
        tenancy,
        prisma,
        envVars: [{ key: envVar.key, value: envVar.value }],
      });
      secretValues.push(...resolved.secretValues);
      if (envVar.isSecret) {
        secretValues.push(...resolved.resolved.map((r) => r.value));
      }
    } catch {
      // See comment above — skip only this var.
    }
  }
  return secretValues;
}

export function redactSecrets(text: string, secretValues: string[]): string {
  let result = text;
  for (const secret of secretValues) {
    if (secret.length === 0) continue;
    result = result.split(secret).join("<redacted>");
  }
  return result;
}

/**
 * Unpacks an uploaded gzipped tarball into deployable files. Defensive on
 * purpose — the tarball is untrusted user input (see limits above; path
 * traversal is rejected by parseTar itself). node_modules and .git are dropped
 * as defense-in-depth even though the CLI already excludes them.
 */
export function unpackSourceTarball(tarballGzipped: Uint8Array): { path: string, data: Uint8Array }[] {
  let tarBytes: Buffer;
  try {
    tarBytes = gunzipSync(tarballGzipped, { maxOutputLength: MAX_TARBALL_UNPACKED_BYTES });
  } catch (e) {
    if (e instanceof RangeError || (e as any)?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new StatusError(400, `Uploaded source tarball is too large when unpacked (max ${MAX_TARBALL_UNPACKED_BYTES} bytes).`);
    }
    throw new StatusError(400, "Uploaded source is not a valid gzip stream.");
  }
  const entries = parseTar(tarBytes, {
    maxEntries: MAX_TARBALL_ENTRIES,
    maxTotalBytes: MAX_TARBALL_UNPACKED_BYTES,
  });
  return entries
    .filter((entry) => !entry.path.endsWith("/"))
    .filter((entry) => {
      const segments = entry.path.split("/");
      return !segments.includes("node_modules") && !segments.includes(".git");
    });
}

export type StartDeploymentResult = {
  runId: string,
};

export async function startDeployment(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  serviceId: string,
  // Passed explicitly (rather than read from tenancy.config) because the deploy
  // route may have just written the definition to the config, and the tenancy
  // object's rendered config is a snapshot from the start of the request.
  definition: DeploymentServiceDefinition,
  buildConfig: {
    framework?: string,
    installCommand?: string,
    buildCommand?: string,
    outputDirectory?: string,
    rootDirectory?: string,
  },
  envVars: { key: string, value: string }[],
  target: "production" | "preview",
  tarballGzipped: Uint8Array,
  triggeredBy: string,
}): Promise<StartDeploymentResult> {
  const { tenancy, prisma, serviceId, definition, buildConfig, envVars, target, tarballGzipped, triggeredBy } = options;
  const client = getVercelDeploymentsClientOrThrow();

  // The deploy request's build config wins over the stored definition for this
  // build (config-as-code: the CLI sends what's in the user's config file).
  const effectiveBuildConfig = {
    framework: buildConfig.framework ?? definition.framework,
    installCommand: buildConfig.installCommand ?? definition.installCommand,
    buildCommand: buildConfig.buildCommand ?? definition.buildCommand,
    outputDirectory: buildConfig.outputDirectory ?? definition.outputDirectory,
    rootDirectory: buildConfig.rootDirectory ?? definition.rootDirectory,
  };

  const service = await getOrCreateOperationalService(prisma, tenancy, serviceId);

  // Lazy provisioning: the Vercel project is created on first deploy only.
  let vercelProjectId = service.vercelProjectId;
  if (vercelProjectId == null) {
    const projectName = vercelProjectNameForService(tenancy.project.id, serviceId);
    let created;
    try {
      created = await client.createProject({
        name: projectName,
        framework: frameworkSlugOrUndefined(effectiveBuildConfig.framework),
      });
    } catch (e) {
      // Name conflict means WE already created this project (the name is
      // namespaced by our project id + service id) but crashed before
      // persisting its id — adopt it instead of being bricked forever on a
      // deterministic conflict. Concurrent first deploys land here too.
      if (e instanceof VercelApiError && e.status === 409) {
        try {
          created = await client.getProject(projectName);
        } catch (adoptError) {
          sanitizeVercelError(adoptError, "Provisioning the deployment target failed");
        }
      } else {
        sanitizeVercelError(e, "Provisioning the deployment target failed");
      }
    }
    vercelProjectId = created.id;
    await prisma.deploymentService.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: service.id } },
      data: { vercelProjectId },
    });
    // Team projects come with Vercel's deployment protection (an SSO auth
    // wall) enabled by default, which would make the customer's site
    // unreachable to the public. Failure to disable it must not fail the
    // deploy — it's diagnosable (the site shows Vercel's auth page) and can
    // be fixed by re-deploying.
    try {
      await client.disableDeploymentProtection(vercelProjectId);
    } catch (e) {
      if (e instanceof VercelApiError) {
        captureError("deployments-disable-deployment-protection", e);
      } else {
        throw e;
      }
    }
  }

  // Persist the build config we actually deploy with (operational cache).
  await prisma.deploymentService.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: service.id } },
    data: {
      framework: effectiveBuildConfig.framework ?? null,
      installCommand: effectiveBuildConfig.installCommand ?? null,
      buildCommand: effectiveBuildConfig.buildCommand ?? null,
      outputDirectory: effectiveBuildConfig.outputDirectory ?? null,
      rootDirectory: effectiveBuildConfig.rootDirectory ?? null,
    },
  });

  // Env push: the deploy request's env set is what gets pushed for this build.
  // It UPSERTS (keys not in this set — e.g. dashboard-managed vars — are left
  // in place on the Vercel project; removing a var is an explicit dashboard/
  // API action, not something a deploy does implicitly). References are
  // resolved server-side; the resolved values go to Vercel as encrypted env
  // vars and are never persisted or logged on our side.
  const { resolved } = await resolveEnvVars({ tenancy, prisma, envVars });
  try {
    await client.upsertEnvVars(vercelProjectId, resolved);
  } catch (e) {
    sanitizeVercelError(e, "Pushing env vars to the deployment failed");
  }

  const files = unpackSourceTarball(tarballGzipped);
  if (files.length === 0) {
    throw new StatusError(400, "Uploaded source tarball contains no files.");
  }

  const deploymentFiles: VercelDeploymentFile[] = files.map((file) => ({
    file: file.path,
    sha: createHash("sha1").update(file.data).digest("hex"),
    size: file.data.length,
  }));
  // Upload with bounded concurrency; Vercel deduplicates by SHA server-side.
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(files.slice(i, i + CONCURRENCY).map(async (file, j) => {
      try {
        await client.uploadFile(deploymentFiles[i + j].sha, file.data);
      } catch (e) {
        sanitizeVercelError(e, `Uploading source file ${JSON.stringify(file.path)} failed`);
      }
    }));
  }

  let deployment;
  try {
    deployment = await client.createDeployment({
      projectId: vercelProjectId,
      projectName: vercelProjectNameForService(tenancy.project.id, serviceId),
      target,
      files: deploymentFiles,
      projectSettings: {
        framework: frameworkSlugOrUndefined(effectiveBuildConfig.framework),
        installCommand: effectiveBuildConfig.installCommand,
        buildCommand: effectiveBuildConfig.buildCommand,
        outputDirectory: effectiveBuildConfig.outputDirectory,
      },
    });
  } catch (e) {
    sanitizeVercelError(e, "Creating the deployment failed");
  }

  const run = await prisma.deploymentRun.create({
    data: {
      tenancyId: tenancy.id,
      deploymentServiceId: service.id,
      vercelDeploymentId: deployment.id,
      vercelDeploymentUrl: deployment.url,
      status: mapVercelReadyState(deployment.readyState),
      target,
      triggeredBy,
    },
  });

  // Write-through for the domains in the service definition. Failures here
  // must not fail the deploy itself (the build is already running), so domain
  // sync problems are surfaced when the user opens the Domains tab instead.
  await syncDefinitionDomainsToVercel({ tenancy, prisma, serviceDbId: service.id, definition, client, vercelProjectId });

  return { runId: run.id };
}

/**
 * Ensures every domain in the service definition exists on the Vercel project
 * and mirrors Vercel's verification state into our rows. Intentionally
 * tolerant: a domain that Vercel rejects (e.g. in use by another team) is
 * recorded as unverified rather than failing the caller — the Domains tab
 * shows per-domain state and errors.
 */
export async function syncDefinitionDomainsToVercel(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  serviceDbId: string,
  definition: DeploymentServiceDefinition,
  client: VercelDeploymentsClient,
  vercelProjectId: string,
}): Promise<void> {
  const { tenancy, prisma, serviceDbId, definition, client, vercelProjectId } = options;
  for (const domain of Object.values(definition.domains)) {
    const hostname = domain.hostname;
    if (hostname == null || hostname === "") continue;
    let verified = false;
    try {
      let vercelDomain;
      try {
        vercelDomain = await client.getProjectDomain(vercelProjectId, hostname);
      } catch (e) {
        if (e instanceof VercelApiError && e.status === 404) {
          vercelDomain = await client.addProjectDomain(vercelProjectId, hostname);
        } else {
          throw e;
        }
      }
      // "Live" needs both the ownership check and correctly-pointed DNS; see
      // the domain read route for why these are separate signals.
      verified = vercelDomain.verified && !await client.isDomainMisconfigured(hostname);
    } catch (e) {
      // NOTHING here may fail the caller — the build is already running on
      // Vercel, so a domain hiccup (4xx like domain-in-use, a transient 5xx,
      // or a network error) must not turn a started deploy into an error.
      // Keep the row unverified; the Domains tab surfaces details on read.
      if (!(e instanceof VercelApiError && e.status >= 400 && e.status < 500)) {
        captureError("deployments-domain-sync", e);
      }
    }
    await prisma.deploymentServiceDomain.upsert({
      where: {
        tenancyId_deploymentServiceId_hostname: {
          tenancyId: tenancy.id,
          deploymentServiceId: serviceDbId,
          hostname,
        },
      },
      update: {
        isPrimary: domain.isPrimary,
        verified,
      },
      create: {
        tenancyId: tenancy.id,
        deploymentServiceId: serviceDbId,
        hostname,
        isPrimary: domain.isPrimary,
        verified,
      },
    });
  }
}

/**
 * Refreshes a non-terminal run from Vercel (poll-on-read — there is no
 * background poller). No-op when the run is already terminal.
 */
export async function refreshRunFromVercel(prisma: PrismaClientTransaction, tenancy: Tenancy, run: {
  id: string,
  status: DeploymentRunStatus,
  vercelDeploymentId: string | null,
}): Promise<void> {
  if (isTerminalRunStatus(run.status) || run.vercelDeploymentId == null) {
    return;
  }
  const client = getVercelDeploymentsClientOrThrow();
  let deployment;
  try {
    deployment = await client.getDeployment(run.vercelDeploymentId);
  } catch (e) {
    sanitizeVercelError(e, "Fetching the deployment status failed");
  }
  const newStatus = mapVercelReadyState(deployment.readyState);
  await prisma.deploymentRun.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
    data: {
      status: newStatus,
      vercelDeploymentUrl: deployment.url ?? undefined,
      error: newStatus === "ERROR" ? (deployment.errorMessage ?? "Deployment failed") : null,
      finishedAt: isTerminalRunStatus(newStatus) ? new Date() : null,
    },
  });
}

export type DnsRecord = {
  type: string,
  name: string,
  value: string,
};

/**
 * The DNS records the user must create for a domain: Vercel's published
 * anycast A record for apex domains, CNAME for subdomains, plus any TXT
 * verification challenges Vercel reports for the domain.
 */
export function computeDnsRecords(hostname: string, apexName: string, verification: { type: string, domain: string, value: string }[] | undefined): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (hostname === apexName) {
    records.push({ type: "A", name: "@", value: "76.76.21.21" });
  } else {
    const subLabel = hostname.endsWith(`.${apexName}`) ? hostname.slice(0, -(apexName.length + 1)) : hostname;
    records.push({ type: "CNAME", name: subLabel, value: "cname.vercel-dns.com" });
  }
  for (const challenge of verification ?? []) {
    records.push({ type: challenge.type, name: challenge.domain, value: challenge.value });
  }
  return records;
}

export type DeploymentServiceApiShape = {
  id: string,
  framework: string | null,
  install_command: string | null,
  build_command: string | null,
  output_directory: string | null,
  root_directory: string | null,
  provisioned: boolean,
  status: "not_deployed" | "queued" | "building" | "deployed" | "failed" | "canceled",
  // Whether any run ever reached READY; the dashboard keeps its "deploy your
  // code" CLI instructions visible until this flips to true.
  has_successful_deploy: boolean,
  url: string | null,
  env_vars: { id: string, key: string, value: string, is_secret: boolean }[],
  domains: { hostname: string, is_primary: boolean, verified: boolean }[],
  latest_run: DeploymentRunApiShape | null,
};

export type DeploymentRunApiShape = {
  id: string,
  service_id: string,
  status: "queued" | "building" | "ready" | "error" | "canceled",
  target: string,
  triggered_by: string,
  url: string | null,
  error: string | null,
  created_at_millis: number,
  finished_at_millis: number | null,
};

export function runToApiShape(run: {
  id: string,
  status: DeploymentRunStatus,
  target: string,
  triggeredBy: string,
  vercelDeploymentUrl: string | null,
  error: string | null,
  createdAt: Date,
  finishedAt: Date | null,
}, serviceId: string): DeploymentRunApiShape {
  return {
    id: run.id,
    service_id: serviceId,
    status: run.status.toLowerCase() as DeploymentRunApiShape["status"],
    target: run.target,
    triggered_by: run.triggeredBy,
    url: run.vercelDeploymentUrl != null ? `https://${run.vercelDeploymentUrl}` : null,
    error: run.error,
    created_at_millis: run.createdAt.getTime(),
    finished_at_millis: run.finishedAt?.getTime() ?? null,
  };
}

type OperationalServiceWithChildren = Prisma.DeploymentServiceGetPayload<{ include: { envVars: true, domains: true } }>;

export async function serviceToApiShape(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  serviceId: string,
  definition: DeploymentServiceDefinition,
  operational: OperationalServiceWithChildren | null,
}): Promise<DeploymentServiceApiShape> {
  const { prisma, tenancy, serviceId, definition, operational } = options;
  let latestRun = operational == null ? null : await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: operational.id,
    },
    orderBy: { createdAt: "desc" },
  });
  // Poll-on-read, like the run endpoints: the dashboard's board only calls the
  // list/read service endpoints, so without this an in-flight deploy would
  // stay "building" on the board forever. Skipped when Vercel isn't
  // configured so listing still works on unconfigured instances.
  if (latestRun != null && !isTerminalRunStatus(latestRun.status) && getVercelDeploymentsConfigOrNull() != null) {
    try {
      await refreshRunFromVercel(prisma, tenancy, latestRun);
      latestRun = await prisma.deploymentRun.findUnique({
        where: { tenancyId_id: { tenancyId: tenancy.id, id: latestRun.id } },
      });
    } catch (e) {
      // A Vercel hiccup must not take down the whole services list; the board
      // just shows the last known status until the next poll.
      captureError("deployments-list-run-refresh", e);
    }
  }
  const hasSuccessfulDeploy = latestRun?.status === "READY" || (operational != null && await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: operational.id,
      status: "READY",
    },
    select: { id: true },
  }) != null);

  const status = ((): DeploymentServiceApiShape["status"] => {
    switch (latestRun?.status) {
      case undefined: {
        return "not_deployed";
      }
      case "QUEUED": {
        return "queued";
      }
      case "BUILDING": {
        return "building";
      }
      case "READY": {
        return "deployed";
      }
      case "ERROR": {
        return "failed";
      }
      case "CANCELED": {
        return "canceled";
      }
    }
  })();

  const verifiedPrimary = operational?.domains.find((d) => d.isPrimary && d.verified) ?? operational?.domains.find((d) => d.verified);
  const url = verifiedPrimary != null
    ? `https://${verifiedPrimary.hostname}`
    : (latestRun?.status === "READY" && latestRun.vercelDeploymentUrl != null ? `https://${latestRun.vercelDeploymentUrl}` : null);

  // The domain list is the union of the definition (desired state) and the
  // operational rows (Vercel-synced state); definition order first, then any
  // operational-only rows (e.g. rows left behind after the definition changed
  // under a GitHub-sourced config) so they stay visible and manageable.
  const operationalByHostname = new Map((operational?.domains ?? []).map((d) => [d.hostname, d]));
  const domains: DeploymentServiceApiShape["domains"] = [];
  for (const domain of Object.values(definition.domains)) {
    if (domain.hostname == null || domain.hostname === "") continue;
    const row = operationalByHostname.get(domain.hostname);
    domains.push({
      hostname: domain.hostname,
      is_primary: domain.isPrimary,
      verified: row?.verified ?? false,
    });
    operationalByHostname.delete(domain.hostname);
  }
  for (const row of operationalByHostname.values()) {
    domains.push({
      hostname: row.hostname,
      is_primary: row.isPrimary,
      verified: row.verified,
    });
  }

  return {
    id: serviceId,
    framework: definition.framework ?? operational?.framework ?? null,
    install_command: definition.installCommand ?? operational?.installCommand ?? null,
    build_command: definition.buildCommand ?? operational?.buildCommand ?? null,
    output_directory: definition.outputDirectory ?? operational?.outputDirectory ?? null,
    root_directory: definition.rootDirectory ?? operational?.rootDirectory ?? null,
    provisioned: operational?.vercelProjectId != null,
    status,
    has_successful_deploy: hasSuccessfulDeploy,
    url,
    env_vars: (operational?.envVars ?? []).map((envVar) => ({
      id: envVar.id,
      key: envVar.key,
      value: envVar.value,
      is_secret: envVar.isSecret,
    })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    domains,
    latest_run: latestRun == null ? null : runToApiShape(latestRun, serviceId),
  };
}
