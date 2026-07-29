// Core logic for the Deployments app: service definitions (synced from the
// config file's `services` export into DeploymentService rows) + operational
// state (Prisma) + the Vercel write-through.
//
// Terminology, because it's easy to mix up:
// - "service id" is the user-facing key of the record returned by the config
//   file's `services` export (e.g. "api"). It's what the CLI and all API
//   routes use.
// - The DeploymentService Prisma row holds BOTH the definition (as last synced
//   by `hexclave deploy` — build config and env var definitions; NOT the
//   config file's `devCommand`, which never leaves the developer's machine) and
//   the operational state (Vercel project id, custom domains, runs). Secret
//   VALUES are never part of a definition; they live in the project secret
//   store (see @/lib/project-secrets), envelope-encrypted via KMS. Neither are secret
//   DEFAULTS (`secret(key, default)`): they travel with the deploy request and
//   are never persisted, so the dashboard's secrets page can present a single
//   unambiguous state — a key either has a stored value or it isn't there.
//
// KNOWN GAP — services removed from the config file. The definitions are
// synced additively: a service that disappears from the `services` export
// keeps its DeploymentService row (still visible in the dashboard) and its
// live Vercel project. Deleting infrastructure automatically on a sync would
// turn a config typo into a torn-down production deployment, so removal is
// deliberately out of scope for now; an auto-cleanup layer (or an explicit
// prune command) is planned to cover it.

import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction, globalPrismaClient } from "@/prisma-client";
import type { DeploymentRunStatus, Prisma } from "@/generated/prisma/client";
import { decryptProjectSecret, listEncryptedProjectSecrets, readProjectSecretValue } from "@/lib/project-secrets";
import { DEPLOYMENT_CONNECTION_VALUE_REGEX, DEPLOYMENT_ENV_VAR_KEY_REGEX, DeploymentEnvVarDefinition, DeploymentServiceDefinition, HEXCLAVE_OUTPUT_KEYS, HEXCLAVE_SERVICE_ID, SERVICE_OUTPUT_KEYS } from "@hexclave/shared/dist/deployments";
import { PROJECT_SECRET_KEY_REGEX } from "@hexclave/shared/dist/project-secrets";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { parseTar } from "@hexclave/shared/dist/utils/tar";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { VercelDeploymentsClient, VercelApiError, VercelDeploymentFile, getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull, sanitizeVercelError } from "./vercel-client";

export { HEXCLAVE_SERVICE_ID };

// Sizes are generous for "source of a web app without node_modules" while
// still bounding what a hostile upload can make the backend allocate.
const MAX_TARBALL_GZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_TARBALL_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 20_000;
export const UPLOAD_EXPIRY_MS = 15 * 60 * 1000;

export const MAX_UPLOAD_BYTES = MAX_TARBALL_GZIPPED_BYTES;

export const ENV_VAR_KEY_REGEX = DEPLOYMENT_ENV_VAR_KEY_REGEX;

export type DeploymentServiceRow = Prisma.DeploymentServiceGetPayload<{ include: { domains: true } }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a DeploymentService row's stored `env` JSON. The column is only ever
 * written through the sync route (which validates against
 * deploymentServiceDefinitionSchema), so a malformed TOP-LEVEL shape is an
 * assertion failure — but individual entries are still normalized leniently at
 * their use sites (see normalizeEnvVarConfig) so one bad entry can't take
 * down a whole listing.
 */
function parseStoredEnv(env: Prisma.JsonValue, serviceId: string): Record<string, DeploymentEnvVarDefinition> {
  if (!isRecord(env)) {
    throw new HexclaveAssertionError(`Stored env of deployment service ${JSON.stringify(serviceId)} is not a record; the sync route should have validated this`, { env });
  }
  const result: Record<string, DeploymentEnvVarDefinition> = {};
  for (const [envVarKey, entry] of Object.entries(env)) {
    if (!isRecord(entry)) {
      captureError("deployments-stored-env-entry-invalid", new HexclaveAssertionError(`Skipping non-object stored env entry ${JSON.stringify(envVarKey)} of service ${JSON.stringify(serviceId)}`));
      continue;
    }
    result[envVarKey] = {
      // Unknown type STRINGS are passed through on purpose (hence the cast:
      // the type system can't express "the union, or an unknown string to be
      // rejected later" without widening every consumer). Erasing them here
      // would silently downgrade the entry to a plain var — while
      // normalizeEnvVarConfig's default branch exists precisely to fail loud
      // on them (hand-edited rows, version skew after a rollback).
      type: typeof entry.type === "string" ? entry.type as DeploymentEnvVarDefinition["type"] : undefined,
      value: typeof entry.value === "string" ? entry.value : undefined,
      key: typeof entry.key === "string" ? entry.key : undefined,
    };
  }
  return result;
}

export function definitionFromServiceRow(row: {
  serviceId: string,
  framework: string | null,
  installCommand: string | null,
  buildCommand: string | null,
  outputDirectory: string | null,
  rootDirectory: string | null,
  env: Prisma.JsonValue,
}): DeploymentServiceDefinition {
  return {
    type: "vercel",
    framework: row.framework ?? undefined,
    install_command: row.installCommand ?? undefined,
    build_command: row.buildCommand ?? undefined,
    output_directory: row.outputDirectory ?? undefined,
    root_directory: row.rootDirectory ?? undefined,
    env: parseStoredEnv(row.env, row.serviceId),
  };
}

export async function listServiceRows(prisma: PrismaClientTransaction, tenancy: Tenancy): Promise<DeploymentServiceRow[]> {
  return await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id },
    include: { domains: true },
    orderBy: { serviceId: "asc" },
  });
}

export async function getServiceRowOrThrow(prisma: PrismaClientTransaction, tenancy: Tenancy, serviceId: string): Promise<DeploymentServiceRow> {
  const row = await prisma.deploymentService.findUnique({
    where: {
      tenancyId_serviceId: {
        tenancyId: tenancy.id,
        serviceId,
      },
    },
    include: { domains: true },
  });
  if (row == null) {
    throw new StatusError(404, `No deployment service with id ${JSON.stringify(serviceId)} exists in this project. Add it to the \`services\` export of your hexclave.config.ts and run \`hexclave deploy\`.`);
  }
  return row;
}

/**
 * Upserts the definitions from a config file's evaluated `services` export
 * into DeploymentService rows. Additive on purpose: rows whose service id is
 * absent from `services` are left untouched (see the KNOWN GAP note at the
 * top of this file).
 */
export async function syncServiceDefinitions(prisma: PrismaClientTransaction, tenancy: Tenancy, services: Record<string, DeploymentServiceDefinition>): Promise<void> {
  for (const [serviceId, definition] of Object.entries(services)) {
    const definitionColumns = {
      definitionSyncedAt: new Date(),
      framework: definition.framework ?? null,
      installCommand: definition.install_command ?? null,
      buildCommand: definition.build_command ?? null,
      outputDirectory: definition.output_directory ?? null,
      rootDirectory: definition.root_directory ?? null,
      // The yup-validated env may contain explicit `undefined` fields, which
      // aren't valid JSON values; filter each entry at this boundary. Spelled
      // out field-by-field so the result is a Prisma-storable
      // Record<string, string> without any type assertions.
      env: Object.fromEntries(Object.entries(definition.env).map(([envVarKey, entry]): [string, Record<string, string>] => {
        const stored: Record<string, string> = {};
        if (entry.type !== undefined) stored.type = entry.type;
        if (entry.value !== undefined) stored.value = entry.value;
        if (entry.key !== undefined) stored.key = entry.key;
        return [envVarKey, stored];
      })),
    };
    await prisma.deploymentService.upsert({
      where: {
        tenancyId_serviceId: {
          tenancyId: tenancy.id,
          serviceId,
        },
      },
      update: definitionColumns,
      create: {
        tenancyId: tenancy.id,
        serviceId,
        ...definitionColumns,
      },
    });
  }
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

// Bare hostname (no scheme/path/port), at least two labels. Shared by every
// path that accepts a hostname so validation can't drift between them again.
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
 * The Vercel project name for a service: `hxc-<hexclaveProjectId>-<serviceId>`,
 * sanitized to Vercel's project name rules (lowercase alphanumeric + hyphens,
 * max 100 chars). The hash is computed from the unsanitized identifiers and
 * retained when the readable prefix is truncated, so two long or
 * punctuation-heavy identifiers cannot collapse to the same Vercel name.
 * Only used at provisioning time — afterwards the persisted Vercel project id
 * is authoritative.
 */
export function vercelProjectNameForService(hexclaveProjectId: string, serviceId: string): string {
  const sanitized = `hxc-${hexclaveProjectId}-${serviceId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const identityHash = createHash("sha256")
    .update(JSON.stringify([hexclaveProjectId, serviceId]))
    .digest("hex")
    .slice(0, 12);
  const readablePrefix = sanitized.slice(0, 100 - identityHash.length - 1).replace(/-+$/, "");
  return `${readablePrefix}-${identityHash}`;
}

// Vercel only accepts known framework slugs; everything else must be omitted
// (Vercel then auto-detects). The config's framework field is free-form, so
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

// A definition env var narrowed into its three valid shapes. The stored
// definition type leaves `type`/`value`/`key` independently optional, so this
// is the boundary where the coupling rules become explicit.
export type NormalizedDeploymentEnvVar =
  | { type: "plain", value: string }
  | { type: "secret", secretKey: string }
  | { type: "connection", serviceId: string, outputKey: string };

/**
 * Narrows a definition env var into one of the three valid shapes, or throws a
 * clean 400. Invalid combinations are rejected by the sync route's schema, but
 * this stays a user-facing error rather than an assertion so a legacy or
 * hand-edited row surfaces as a per-entry problem instead of a 500.
 */
export function normalizeEnvVarConfig(envVarKey: string, config: DeploymentEnvVarDefinition): NormalizedDeploymentEnvVar {
  switch (config.type) {
    case "secret": {
      if (config.key == null || !PROJECT_SECRET_KEY_REGEX.test(config.key)) {
        throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} has type "secret" but no valid secret key (letters, numbers, underscores, and hyphens).`);
      }
      return { type: "secret", secretKey: config.key };
    }
    case "connection": {
      if (config.value == null || !DEPLOYMENT_CONNECTION_VALUE_REGEX.test(config.value)) {
        throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} has type "connection" but its value is not a service output reference like "hexclave.projectId".`);
      }
      // The regex guarantees exactly one dot (neither side's character class
      // allows one), so this split is unambiguous.
      const dotIndex = config.value.indexOf(".");
      return { type: "connection", serviceId: config.value.slice(0, dotIndex), outputKey: config.value.slice(dotIndex + 1) };
    }
    case undefined: {
      if (config.value == null) {
        throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} has no value. Add a \`value\`, or give it a type ("secret" or "connection").`);
      }
      return { type: "plain", value: config.value };
    }
    default: {
      // TS considers the switch exhaustive, but the value comes from stored
      // JSON — a write path that skips validation (or a direct DB edit) could
      // store any string, and returning undefined here would crash callers
      // with a TypeError instead of a clean per-entry error.
      throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} has an unknown type ${JSON.stringify(config.type)}. Supported: "secret", "connection", or no type for a plain value.`);
    }
  }
}

/**
 * Resolves a service's definition env vars into the literal key/value pairs to
 * push to the deployment target:
 * - plain vars pass through,
 * - secret vars are filled from the project's stored secrets (dashboard →
 *   Project Settings → Secrets), falling back to `secretDefaults` — the
 *   deploy request's transient copy of the `secret(key, default)` defaults
 *   from the config file. Defaults are deliberately NOT part of the stored
 *   definition: they are an author-side convenience that the dashboard must
 *   never surface (a stored default would make "this secret has a value"
 *   ambiguous on the secrets page). A secret with neither is a 400 that lists
 *   every missing key at once — failing loud beats silently deploying without
 *   them,
 * - connection vars resolve another service's output server-side. Supported
 *   outputs: `hexclave.{projectId|apiUrl|jwksUrl|publishableClientKey|secretServerKey}`
 *   from the managed Hexclave service, and `<serviceId>.url` from
 *   other deployment services.
 * Error messages only ever contain reference tokens (pointers), never any
 * resolved value.
 */
export async function resolveEnvVars(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  // The service these env vars belong to; used to reject self-referential
  // connections (a service whose env needs its own deployment output can
  // never be deployed for the first time).
  serviceId: string,
  env: Record<string, DeploymentEnvVarDefinition>,
  // Deploy-request-only fallbacks for `secret()` env vars, keyed by ENV VAR
  // key (see deploymentSecretDefaultsSchema). Never read from the database.
  secretDefaults: Record<string, string>,
}): Promise<{ key: string, value: string }[]> {
  const { tenancy, prisma, serviceId, env, secretDefaults } = options;
  const existingServiceIds = new Set((await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id },
    select: { serviceId: true },
  })).map((row) => row.serviceId));

  // Cache per-service/per-output resolution so N connections to the same
  // output don't repeat DB queries, and per-secret reads so N env vars filled
  // from the same secret don't repeat KMS decryptions.
  const outputCache = new Map<string, Promise<{ value: string, secret: boolean }>>();
  const resolveOutput = (targetServiceId: string, outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> => {
    const cacheKey = `${targetServiceId}\0${outputKey}`;
    const cached = outputCache.get(cacheKey);
    if (cached != null) return cached;
    const promise = (async () => {
      if (targetServiceId === HEXCLAVE_SERVICE_ID) {
        return await resolveHexclaveOutput(tenancy, outputKey, raw);
      }
      return await resolveServiceOutput(prisma, tenancy, targetServiceId, outputKey, raw);
    })();
    outputCache.set(cacheKey, promise);
    return promise;
  };
  const secretCache = new Map<string, Promise<string | null>>();
  const readSecret = (secretKey: string): Promise<string | null> => {
    const cached = secretCache.get(secretKey);
    if (cached != null) return cached;
    const promise = readProjectSecretValue(tenancy.project.id, secretKey);
    secretCache.set(secretKey, promise);
    return promise;
  };

  const missingSecretKeys: string[] = [];
  const resolved: { key: string, value: string }[] = [];
  for (const [envVarKey, config] of Object.entries(env)) {
    if (!ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new StatusError(400, `Invalid env var key: ${JSON.stringify(envVarKey)}. Keys must match ${ENV_VAR_KEY_REGEX.toString()}.`);
    }
    const normalized = normalizeEnvVarConfig(envVarKey, config);
    switch (normalized.type) {
      case "plain": {
        resolved.push({ key: envVarKey, value: normalized.value });
        break;
      }
      case "secret": {
        const storedValue = await readSecret(normalized.secretKey);
        // `Object.hasOwn` rather than a truthiness/`??` check on the lookup:
        // an empty-string default is a legitimate value, and a plain property
        // read would also pick up Object.prototype members for env var keys
        // like "constructor".
        const secretValue = storedValue ?? (Object.hasOwn(secretDefaults, envVarKey) ? secretDefaults[envVarKey] : undefined);
        if (secretValue == null) {
          missingSecretKeys.push(normalized.secretKey);
          break;
        }
        resolved.push({ key: envVarKey, value: secretValue });
        break;
      }
      case "connection": {
        const raw = `${normalized.serviceId}.${normalized.outputKey}`;
        // Static validation first — these can never become resolvable later.
        if (normalized.serviceId === serviceId) {
          throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} connects to the service's own output "${raw}". A service cannot reference itself — its first deploy could never satisfy it.`);
        }
        if (normalized.serviceId === HEXCLAVE_SERVICE_ID) {
          if (!(HEXCLAVE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
            throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. The hexclave service exposes: ${HEXCLAVE_OUTPUT_KEYS.join(", ")}.`);
          }
        } else {
          if (!existingServiceIds.has(normalized.serviceId)) {
            throw new StatusError(400, `The env var connection "${raw}" points to a service that doesn't exist in this project. Add it to the \`services\` export of your hexclave.config.ts and deploy it first.`);
          }
          if (!(SERVICE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
            throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. Deployment services expose: ${SERVICE_OUTPUT_KEYS.join(", ")}.`);
          }
        }
        const output = await resolveOutput(normalized.serviceId, normalized.outputKey, raw);
        resolved.push({ key: envVarKey, value: output.value });
        break;
      }
    }
  }

  if (missingSecretKeys.length > 0) {
    const uniqueMissing = [...new Set(missingSecretKeys)].sort(stringCompare);
    throw new StatusError(400, `Missing values for ${uniqueMissing.length === 1 ? "secret" : "secrets"}: ${uniqueMissing.join(", ")}. All of these must be set in the dashboard under Project Settings > Secrets before this service can deploy.`);
  }

  return resolved;
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
        throw new StatusError(400, `The env var connection "${raw}" can't be resolved because the project has no active API key of that kind. Create one in the dashboard under "API Keys" first.`);
      }
      if (outputKey === "publishableClientKey") {
        return { value: keySet.publishableClientKey ?? throwErr("publishableClientKey is null despite filter; this should never happen"), secret: false };
      }
      return { value: keySet.secretServerKey ?? throwErr("secretServerKey is null despite filter; this should never happen"), secret: true };
    }
    default: {
      throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. The hexclave service exposes: ${HEXCLAVE_OUTPUT_KEYS.join(", ")}.`);
    }
  }
}

async function resolveServiceOutput(prisma: PrismaClientTransaction, tenancy: Tenancy, serviceId: string, outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> {
  if (outputKey !== "url") {
    throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. Deployment services expose: ${SERVICE_OUTPUT_KEYS.join(", ")}.`);
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
  const primaryDomain = service?.domains.find((d) => d.isPrimary && d.verified) ?? service?.domains.find((d) => d.verified);
  if (primaryDomain != null) {
    return { value: `https://${primaryDomain.hostname}`, secret: false };
  }
  // Without a verified domain this deliberately resolves to the latest READY
  // run's IMMUTABLE per-deployment URL, not a stable project alias: the
  // platform-owned Vercel project's default alias is an internal name we don't
  // want baked into customer builds, and a connection consumer is re-resolved
  // on ITS next deploy anyway. The tradeoff (consumer pins the producer's
  // deployment until the consumer redeploys) is accepted for now; a stable
  // per-service domain would remove it.
  const latestReadyRun = service == null ? null : await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: service.id,
      status: "READY",
      target: "production",
      vercelDeploymentUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });
  if (latestReadyRun?.vercelDeploymentUrl == null) {
    throw new StatusError(400, `The env var connection "${raw}" can't be resolved because the service ${JSON.stringify(serviceId)} has no successful production deployment yet. Deploy it first.`);
  }
  return { value: `https://${latestReadyRun.vercelDeploymentUrl}`, secret: false };
}

/**
 * Everything we can re-derive as secret for a service's build logs: every
 * secret API key of the project (covers the `hexclave.secretServerKey`
 * connection output), plus the project's CURRENTLY-stored project secret
 * values. Note the limit of that last part: a value that was later
 * overwritten or deleted is no longer known here, so old logs that captured
 * it are only redacted while it is still stored — rotation does not
 * retroactively scrub earlier runs' logs.
 */
export async function collectLogRedactionSecrets(options: {
  tenancy: Tenancy,
}): Promise<string[]> {
  const { tenancy } = options;
  const secretValues: string[] = [];
  const apiKeySets = await globalPrismaClient.apiKeySet.findMany({
    where: { projectId: tenancy.project.id },
    select: { secretServerKey: true, superSecretAdminKey: true },
  });
  for (const keySet of apiKeySets) {
    if (keySet.secretServerKey != null) secretValues.push(keySet.secretServerKey);
    if (keySet.superSecretAdminKey != null) secretValues.push(keySet.superSecretAdminKey);
  }
  const secretRows = await listEncryptedProjectSecrets(tenancy.project.id);
  for (const row of secretRows) {
    try {
      secretValues.push(await decryptProjectSecret(row.encrypted, row.key));
    } catch (error) {
      // One corrupt/undecryptable row must not 500 every log read of the
      // whole project. Skipping it is safe for redaction: a value we cannot
      // decrypt was never resolved into a build either (its deploys would
      // have failed the same way), so it cannot appear in any log.
      captureError("deployments-log-redaction-secret", error);
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
  // The stored definition of the service (from its DeploymentService row).
  definition: DeploymentServiceDefinition,
  // Already resolved by the caller (via resolveEnvVars) BEFORE the upload was
  // consumed, so a missing secret or dangling connection fails the request
  // without spending the upload.
  resolvedEnvVars: { key: string, value: string }[],
  target: "production" | "preview",
  tarballGzipped: Uint8Array,
  triggeredBy: string,
}): Promise<StartDeploymentResult> {
  const { tenancy, prisma, serviceId, definition, resolvedEnvVars, target, tarballGzipped, triggeredBy } = options;
  const client = getVercelDeploymentsClientOrThrow();

  const service = await getOrCreateOperationalService(prisma, tenancy, serviceId);

  // Lazy provisioning: the Vercel project is created on first deploy only.
  let vercelProjectId = service.vercelProjectId;
  if (vercelProjectId == null) {
    const projectName = vercelProjectNameForService(tenancy.project.id, serviceId);
    let created;
    try {
      created = await client.createProject({
        name: projectName,
        framework: frameworkSlugOrUndefined(definition.framework),
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
  }

  // Team projects can inherit Vercel's deployment protection (an SSO auth
  // wall), which would make the customer's site unreachable to the public.
  // Run this on every deploy rather than only during provisioning: a transient
  // failure on the first deploy must be retried, and a later team-policy change
  // must not permanently re-protect the project.
  try {
    await client.disableDeploymentProtection(vercelProjectId);
  } catch (e) {
    if (e instanceof VercelApiError) {
      captureError("deployments-disable-deployment-protection", e);
    } else {
      throw e;
    }
  }

  // Env push: the definition's resolved env set is authoritative for the
  // Vercel project — upsert the current set, then delete keys no longer in the
  // definition so a var removed from the config actually stops being injected
  // into builds. The resolved set covers the WHOLE definition here: deploys
  // fail earlier on missing secrets or unresolvable connections, so diffing
  // against it cannot delete a merely-skipped key. Resolved values go to
  // Vercel as encrypted env vars; secret plaintext exists only in this request
  // and on Vercel.
  try {
    await client.upsertEnvVars(vercelProjectId, resolvedEnvVars);
    const definitionKeys = new Set(resolvedEnvVars.map((envVar) => envVar.key));
    const vercelVars = await client.listEnvVarKeys(vercelProjectId);
    for (const vercelVar of vercelVars) {
      if (!definitionKeys.has(vercelVar.key)) {
        await client.deleteEnvVar(vercelProjectId, vercelVar.id);
      }
    }
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
        framework: frameworkSlugOrUndefined(definition.framework),
        installCommand: definition.install_command,
        buildCommand: definition.build_command,
        outputDirectory: definition.output_directory,
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

  // Write-through for the service's domains. Failures here must not fail the
  // deploy itself (the build is already running), so domain sync problems are
  // surfaced when the user opens the Domains tab instead.
  await syncServiceDomainsToVercel({ tenancy, prisma, serviceDbId: service.id, client, vercelProjectId });

  return { runId: run.id };
}

/**
 * Ensures every domain row of the service exists on the Vercel project and
 * mirrors Vercel's verification state back into the rows. Domains added in the
 * dashboard before the first deploy only exist as rows (there is no Vercel
 * project yet), so this runs on every deploy to push them once the project is
 * provisioned — and it self-heals rows that drifted from Vercel afterwards.
 * Intentionally tolerant: a domain that Vercel rejects (e.g. in use by another
 * team) is recorded as unverified rather than failing the caller — the Domains
 * tab shows per-domain state and errors.
 */
export async function syncServiceDomainsToVercel(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  serviceDbId: string,
  client: VercelDeploymentsClient,
  vercelProjectId: string,
}): Promise<void> {
  const { tenancy, prisma, serviceDbId, client, vercelProjectId } = options;
  const domains = await prisma.deploymentServiceDomain.findMany({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: serviceDbId,
    },
  });
  for (const domain of domains) {
    // null = the check didn't complete; the row is left untouched then, so a
    // transient Vercel/network error during a deploy can't clobber a
    // previously-verified domain back to unverified (which would also make
    // `<service>.url` connections resolve to the wrong URL until re-checked).
    let verified: boolean | null = null;
    try {
      let vercelDomain;
      try {
        vercelDomain = await client.getProjectDomain(vercelProjectId, domain.hostname);
      } catch (e) {
        if (e instanceof VercelApiError && e.status === 404) {
          vercelDomain = await client.addProjectDomain(vercelProjectId, domain.hostname);
        } else {
          throw e;
        }
      }
      // "Live" needs both the ownership check and correctly-pointed DNS; see
      // the domain read route for why these are separate signals.
      verified = vercelDomain.verified && !await client.isDomainMisconfigured(domain.hostname);
    } catch (e) {
      // NOTHING here may fail the caller — the build is already running on
      // Vercel, so a domain hiccup (4xx like domain-in-use, a transient 5xx,
      // or a network error) must not turn a started deploy into an error.
      // A 4xx is a real answer from Vercel about THIS domain (e.g. in use by
      // another team) — record it as unverified; anything else is transient.
      if (e instanceof VercelApiError && e.status >= 400 && e.status < 500) {
        verified = false;
      } else {
        captureError("deployments-domain-sync", e);
      }
    }
    if (verified != null) {
      await prisma.deploymentServiceDomain.update({
        where: { tenancyId_id: { tenancyId: tenancy.id, id: domain.id } },
        data: { verified },
      });
    }
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
  type: "vercel",
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
  // The definition's env vars, normalized: `value` is the literal value for
  // plain vars and the "serviceId.outputKey" reference for connections;
  // `secret_key` names the secret for secret vars (their values are
  // write-only, so there is nothing else to show — in particular, a
  // `secret(key, default)` fallback never reaches the server outside the
  // deploy request, so there is nothing here to report about it either).
  env: { key: string, type: "plain" | "secret" | "connection", value: string | null, secret_key: string | null }[],
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

export async function serviceToApiShape(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  row: DeploymentServiceRow,
}): Promise<DeploymentServiceApiShape> {
  const { prisma, tenancy, row } = options;
  const definition = definitionFromServiceRow(row);
  let latestRun = await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: row.id,
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
  const hasSuccessfulDeploy = latestRun?.status === "READY" || await prisma.deploymentRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: row.id,
      status: "READY",
    },
    select: { id: true },
  }) != null;

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

  const verifiedPrimary = row.domains.find((d) => d.isPrimary && d.verified) ?? row.domains.find((d) => d.verified);
  const url = verifiedPrimary != null
    ? `https://${verifiedPrimary.hostname}`
    : (latestRun?.status === "READY" && latestRun.vercelDeploymentUrl != null ? `https://${latestRun.vercelDeploymentUrl}` : null);

  const domains = row.domains
    .map((domainRow) => ({
      hostname: domainRow.hostname,
      is_primary: domainRow.isPrimary,
      verified: domainRow.verified,
    }))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || stringCompare(a.hostname, b.hostname));

  const env: DeploymentServiceApiShape["env"] = [];
  for (const [envVarKey, config] of Object.entries(definition.env)) {
    // Tolerate incomplete entries (possible in legacy or hand-edited rows —
    // see normalizeEnvVarConfig): one bad entry must not take down the whole
    // service list. Deploys of this service still fail loudly on it.
    let normalized;
    try {
      normalized = normalizeEnvVarConfig(envVarKey, config);
    } catch (e) {
      if (!(e instanceof StatusError)) throw e;
      captureError("deployments-env-var-config-invalid", new HexclaveAssertionError(`Skipping invalid deployment env var config entry ${JSON.stringify(envVarKey)} of service ${JSON.stringify(row.serviceId)}`, { cause: e }));
      continue;
    }
    env.push({
      key: envVarKey,
      type: normalized.type,
      value: normalized.type === "plain" ? normalized.value : normalized.type === "connection" ? `${normalized.serviceId}.${normalized.outputKey}` : null,
      secret_key: normalized.type === "secret" ? normalized.secretKey : null,
    });
  }
  env.sort((a, b) => stringCompare(a.key, b.key));

  return {
    id: row.serviceId,
    type: definition.type,
    framework: definition.framework ?? null,
    install_command: definition.install_command ?? null,
    build_command: definition.build_command ?? null,
    output_directory: definition.output_directory ?? null,
    root_directory: definition.root_directory ?? null,
    provisioned: row.vercelProjectId != null,
    status,
    has_successful_deploy: hasSuccessfulDeploy,
    url,
    env,
    domains,
    latest_run: latestRun == null ? null : runToApiShape(latestRun, row.serviceId),
  };
}
