// Core logic for the Deployments app: service definitions (synced from the
// config file's `services` export into DeploymentService rows) + operational
// state (Prisma) + the write-through to Marshal, the Fly.io-backed container
// runtime (apps/marshal).
//
// Terminology, because it's easy to mix up:
// - "service id" is the user-facing key of the record returned by the config
//   file's `services` export (e.g. "api"). It's what the CLI and all API
//   routes use, and it doubles as the Marshal service key.
// - The Marshal "namespace" is the tenancy id: every runtime resource of a
//   tenancy lives behind one namespace, and Marshal keeps namespaces
//   network-isolated from each other.
// - The DeploymentService Prisma row holds BOTH the definition (as last synced
//   by `hexclave deploy` — container config and env var definitions; NOT the
//   config file's `devCommand`, which never leaves the developer's machine) and
//   the operational state (custom domains, runs). Secret VALUES are never part
//   of a definition; they live in the project secret store (see
//   @/lib/project-secrets), envelope-encrypted via KMS. Neither are secret
//   DEFAULTS (`secret(key, default)`): they travel with the deploy request and
//   are never persisted, so the dashboard's secrets page can present a single
//   unambiguous state — a key either has a stored value or it isn't there.
//
// KNOWN GAP — services removed from the config file. The definitions are
// synced additively: a service that disappears from the `services` export
// keeps its DeploymentService row (still visible in the dashboard) and its
// live Marshal service. Deleting infrastructure automatically on a sync would
// turn a config typo into a torn-down production deployment, so removal is
// deliberately out of scope for now; an auto-cleanup layer (or an explicit
// prune command) is planned to cover it.

import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction, globalPrismaClient } from "@/prisma-client";
import type { DeploymentRunStatus, Prisma } from "@/generated/prisma/client";
import { readProjectSecretValue } from "@/lib/project-secrets";
import { DEPLOYMENT_CONNECTION_VALUE_REGEX, DEPLOYMENT_ENV_VAR_KEY_REGEX, DeploymentEnvVarDefinition, DeploymentServiceDefinition, HEXCLAVE_OUTPUT_KEYS, HEXCLAVE_SERVICE_ID, SERVICE_OUTPUT_KEYS, ServiceOutputKey } from "@hexclave/shared/dist/deployments";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { PROJECT_SECRET_KEY_REGEX } from "@hexclave/shared/dist/project-secrets";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { MarshalApiError, MarshalClient, MarshalDnsRecord, MarshalEnvValue, getMarshalClientOrThrow, getMarshalDeploymentsConfigOrNull, sanitizeMarshalError } from "./marshal-client";

export { HEXCLAVE_SERVICE_ID };

export const ENV_VAR_KEY_REGEX = DEPLOYMENT_ENV_VAR_KEY_REGEX;

// Default scaling bounds when the definition leaves them out: scale-to-zero
// serverless with a single instance.
export const DEFAULT_MIN_INSTANCES = 0;
export const DEFAULT_MAX_INSTANCES = 1;

export type DeploymentServiceRow = Prisma.DeploymentServiceGetPayload<{ include: { domains: true } }>;

// Every read of a service's domains goes through this, because the
// "primary verified domain, else ANY verified domain" fallback below (and in
// serializeServiceRow) is order-sensitive: with two verified non-primary
// domains, an unordered include would let the URL we bake into a consumer's
// build — and the one the API reports — flip between reads.
const DOMAINS_INCLUDE_ORDER = { orderBy: { hostname: "asc" } } as const satisfies Prisma.DeploymentService$domainsArgs;

/** The Marshal namespace of a tenancy. One place so it cannot drift. */
export function marshalNamespaceForTenancy(tenancy: Tenancy): string {
  return tenancy.id;
}

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
  port: number | null,
  minInstances: number | null,
  maxInstances: number | null,
  rootDirectory: string | null,
  dockerfilePath: string | null,
  env: Prisma.JsonValue,
}): DeploymentServiceDefinition {
  return {
    type: "container",
    // Rows that predate a synced definition have no port. The `0` placeholder is only ever
    // reached by display-only callers (serviceToApiShape reads row.port directly, and the
    // deploy route guards `row.port == null` before building a spec), so it never reaches
    // Marshal — but note `0` is NOT a valid ServiceSpec port, so any future path that sends
    // definitionFromServiceRow's output to Marshal must guard the null-port case first.
    port: row.port ?? 0,
    min_instances: row.minInstances ?? undefined,
    max_instances: row.maxInstances ?? undefined,
    root_directory: row.rootDirectory ?? undefined,
    dockerfile_path: row.dockerfilePath ?? undefined,
    env: parseStoredEnv(row.env, row.serviceId),
  };
}

export async function listServiceRows(prisma: PrismaClientTransaction, tenancy: Tenancy): Promise<DeploymentServiceRow[]> {
  return await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id },
    include: { domains: DOMAINS_INCLUDE_ORDER },
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
    include: { domains: DOMAINS_INCLUDE_ORDER },
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
export async function syncServiceDefinitions(prisma: PrismaClientTransaction, tenancy: Tenancy, services: Record<string, DeploymentServiceDefinition>, definitionSyncId: string): Promise<void> {
  for (const [serviceId, definition] of Object.entries(services)) {
    const definitionColumns = {
      definitionSyncedAt: new Date(),
      definitionSyncId,
      port: definition.port,
      minInstances: definition.min_instances ?? null,
      maxInstances: definition.max_instances ?? null,
      rootDirectory: definition.root_directory ?? null,
      dockerfilePath: definition.dockerfile_path ?? null,
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

export function mapMarshalBuildStatus(status: string): DeploymentRunStatus {
  switch (status) {
    case "queued": {
      return "QUEUED";
    }
    case "running": {
      return "BUILDING";
    }
    case "succeeded": {
      return "READY";
    }
    case "failed": {
      return "ERROR";
    }
    case "canceled": {
      return "CANCELED";
    }
    default: {
      // Marshal added a state we don't know; treat it as still-building so
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

// The config-file output keys (camelCase, what `service("api").internalUrl` produces) mapped
// to the Marshal runtime's snake_case output keys. `satisfies Record<ServiceOutputKey, …>`
// makes adding a key to SERVICE_OUTPUT_KEYS without a mapping here a compile error — otherwise
// the lookup would yield `undefined` and emit `{ ref: "api.undefined" }`, a run that blocks
// forever with an unactionable message.
const SERVICE_OUTPUT_KEY_TO_MARSHAL = {
  url: "url",
  internalUrl: "internal_url",
  internalHost: "internal_host",
} satisfies Record<ServiceOutputKey, string>;

/**
 * Resolves a service's definition env vars into the EnvValue map sent to
 * Marshal:
 * - plain vars pass through as literal `{ value }`s,
 * - secret vars are filled from the project's stored secrets (dashboard →
 *   Project Settings → Secrets), falling back to `secretDefaults` — the
 *   deploy request's transient copy of the `secret(key, default)` defaults
 *   from the config file. Defaults are deliberately NOT part of the stored
 *   definition: they are an author-side convenience that the dashboard must
 *   never surface (a stored default would make "this secret has a value"
 *   ambiguous on the secrets page). A secret with neither is a 400 that lists
 *   every missing key at once — failing loud beats silently deploying without
 *   them,
 * - `hexclave.*` connections resolve the managed Hexclave service's outputs
 *   server-side (they are backend state, not runtime state),
 * - `<serviceId>.<output>` connections to other deployment services become
 *   Marshal `{ ref }`s, resolved by the runtime itself: `internalUrl`/
 *   `internalHost` are deterministic and never block. `url` needs a verified
 *   domain on the target; if none exists yet, Marshal reports the service
 *   `blocked` and the RUN FAILS (refreshRunFromMarshal finalizes it ERROR).
 *   There is no automatic re-apply when the target's domain later verifies —
 *   the user must re-deploy. (Marshal's `needsBuild` is keyed to make such a
 *   re-apply a no-op-safe convergence point; wiring a domain-verify → re-PUT
 *   trigger is a tracked follow-up.) Prefer `internalUrl` for service wiring.
 * Error messages only ever contain reference tokens (pointers), never any
 * resolved value.
 */
export async function resolveEnvVars(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  // The service these env vars belong to; used to reject self-referential
  // `url` connections (a service whose public URL feeds its own env could
  // never bootstrap; the internal outputs are deterministic and fine).
  serviceId: string,
  env: Record<string, DeploymentEnvVarDefinition>,
  // Deploy-request-only fallbacks for `secret()` env vars, keyed by ENV VAR
  // key (see deploymentSecretDefaultsSchema). Never read from the database.
  secretDefaults: Record<string, string>,
}): Promise<{
  resolvedEnv: Record<string, MarshalEnvValue>,
  redactionSecrets: string[],
}> {
  const { tenancy, prisma, serviceId, env, secretDefaults } = options;
  const existingServiceIds = new Set((await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id },
    select: { serviceId: true },
  })).map((row) => row.serviceId));

  // Cache per-secret reads so N env vars filled from the same secret don't
  // repeat KMS decryptions, and per-output resolution for hexclave.* outputs.
  const outputCache = new Map<string, Promise<{ value: string, secret: boolean }>>();
  const resolveHexclaveOutputCached = (outputKey: string, raw: string): Promise<{ value: string, secret: boolean }> => {
    const cached = outputCache.get(outputKey);
    if (cached != null) return cached;
    const promise = resolveHexclaveOutput(tenancy, outputKey, raw);
    outputCache.set(outputKey, promise);
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
  const resolvedEnv: Record<string, MarshalEnvValue> = {};
  const redactionSecrets = new Set<string>();
  for (const [envVarKey, config] of Object.entries(env)) {
    if (!ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new StatusError(400, `Invalid env var key: ${JSON.stringify(envVarKey)}. Keys must match ${ENV_VAR_KEY_REGEX.toString()}.`);
    }
    const normalized = normalizeEnvVarConfig(envVarKey, config);
    switch (normalized.type) {
      case "plain": {
        resolvedEnv[envVarKey] = { value: normalized.value };
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
        resolvedEnv[envVarKey] = { value: secretValue };
        if (secretValue.length > 0) redactionSecrets.add(secretValue);
        break;
      }
      case "connection": {
        const raw = `${normalized.serviceId}.${normalized.outputKey}`;
        if (normalized.serviceId === HEXCLAVE_SERVICE_ID) {
          if (!(HEXCLAVE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
            throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. The hexclave service exposes: ${HEXCLAVE_OUTPUT_KEYS.join(", ")}.`);
          }
          const output = await resolveHexclaveOutputCached(normalized.outputKey, raw);
          resolvedEnv[envVarKey] = { value: output.value };
          if (output.secret && output.value.length > 0) redactionSecrets.add(output.value);
          break;
        }
        // Static validation first — these can never become resolvable later.
        if (normalized.serviceId === serviceId && normalized.outputKey === "url") {
          throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} connects to the service's own public URL "${raw}", which cannot exist before the service does. Use ${JSON.stringify(`${serviceId}.internalUrl`)} for the service's own address.`);
        }
        if (!existingServiceIds.has(normalized.serviceId) && normalized.serviceId !== serviceId) {
          throw new StatusError(400, `The env var connection "${raw}" points to a service that doesn't exist in this project. Add it to the \`services\` export of your hexclave.config.ts and deploy it first.`);
        }
        if (!(SERVICE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
          throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. Deployment services expose: ${SERVICE_OUTPUT_KEYS.join(", ")}.`);
        }
        // Narrowed by the includes() check above; the map is `satisfies Record<ServiceOutputKey,…>`.
        const marshalOutputKey = SERVICE_OUTPUT_KEY_TO_MARSHAL[normalized.outputKey as ServiceOutputKey];
        // The runtime resolves service-to-service refs itself: internal addresses are
        // deterministic there. A `url` whose target has no verified domain yet makes the
        // service `blocked` — the run then fails (there is no backend re-apply on domain
        // verification yet; see startDeployment / refreshRunFromMarshal). Prefer internalUrl
        // for service-to-service wiring.
        resolvedEnv[envVarKey] = { ref: `${normalized.serviceId}.${marshalOutputKey}` };
        break;
      }
    }
  }

  if (missingSecretKeys.length > 0) {
    const uniqueMissing = [...new Set(missingSecretKeys)].sort(stringCompare);
    throw new StatusError(400, `Missing values for ${uniqueMissing.length === 1 ? "secret" : "secrets"}: ${uniqueMissing.join(", ")}. All of these must be set in the dashboard under Project Settings > Secrets before this service can deploy.`);
  }

  return {
    resolvedEnv,
    redactionSecrets: [...redactionSecrets],
  };
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

export type EncryptedDeploymentRedactionSecrets = {
  edkBase64: string,
  ciphertextBase64: string,
};

/**
 * Encrypts the exact sensitive values injected into one run. The snapshot is
 * run-scoped rather than project-scoped: request-only defaults never enter the
 * project secret store, and rotating/deleting a stored secret must not make its
 * earlier build logs unsafe to read.
 */
export async function encryptDeploymentRedactionSecrets(secretValues: string[]): Promise<EncryptedDeploymentRedactionSecrets> {
  const uniqueNonEmptyValues = [...new Set(secretValues)].filter((value) => value.length > 0);
  return await encryptWithKms(JSON.stringify(uniqueNonEmptyValues));
}

/**
 * Decrypts a run's complete redaction set. Missing or malformed material fails
 * closed: returning a partial set would turn a KMS/data problem into plaintext
 * credential disclosure through the logs endpoint.
 */
export async function decryptDeploymentRedactionSecrets(encrypted: Prisma.JsonValue | null): Promise<string[]> {
  if (encrypted == null) {
    throw new StatusError(409, "Build logs for this deployment are unavailable because it predates secure per-run secret redaction.");
  }
  if (!isRecord(encrypted) || typeof encrypted.edkBase64 !== "string" || typeof encrypted.ciphertextBase64 !== "string") {
    throw new HexclaveAssertionError("Stored deployment-run redaction material has an invalid encrypted payload; the deploy route should have written { edkBase64, ciphertextBase64 }");
  }
  const decrypted = await decryptWithKms({
    edkBase64: encrypted.edkBase64,
    ciphertextBase64: encrypted.ciphertextBase64,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch (error) {
    throw new HexclaveAssertionError("Stored deployment-run redaction material did not decrypt to valid JSON", { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new HexclaveAssertionError("Stored deployment-run redaction material did not decrypt to an array");
  }
  const result = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== "string") {
      throw new HexclaveAssertionError("Stored deployment-run redaction material contains a non-string value");
    }
    if (value.length > 0) result.add(value);
  }
  return [...result];
}

export function redactSecrets(text: string, secretValues: string[]): string {
  let result = text;
  for (const secret of secretValues) {
    if (secret.length === 0) continue;
    result = result.split(secret).join("<redacted>");
  }
  return result;
}

/** Assembles the Marshal service spec for a service's stored definition. */
export function marshalSpecForDefinition(definition: DeploymentServiceDefinition, source: { upload_id: string } | { image: string }, resolvedEnv: Record<string, MarshalEnvValue>) {
  const minInstances = definition.min_instances ?? DEFAULT_MIN_INSTANCES;
  return {
    config: {
      min_instances: minInstances,
      // Default max to at least min: a definition with `minInstances` and no `maxInstances`
      // must not synthesize an invalid spec (max < min) that Marshal 400s after the upload is
      // already consumed. Validation (CLI + schema) also rejects it up front now, but this
      // keeps the spec self-consistent regardless.
      max_instances: definition.max_instances ?? Math.max(minInstances, DEFAULT_MAX_INSTANCES),
      port: definition.port,
    },
    // dockerfile_path only matters when there is something to build; absent =
    // the builder auto-detects the build with Railpack.
    source: "upload_id" in source
      ? { ...source, ...(definition.dockerfile_path !== undefined ? { dockerfile_path: definition.dockerfile_path } : {}) }
      : source,
    env: resolvedEnv,
  };
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
  resolvedEnv: Record<string, MarshalEnvValue>,
  redactionSecretsEncrypted: EncryptedDeploymentRedactionSecrets,
  // The Marshal upload slot id holding the source tarball.
  marshalUploadId: string,
  triggeredBy: string,
}): Promise<StartDeploymentResult> {
  const { tenancy, prisma, serviceId, definition, resolvedEnv, redactionSecretsEncrypted, marshalUploadId, triggeredBy } = options;
  const client = getMarshalClientOrThrow();
  const ns = marshalNamespaceForTenancy(tenancy);

  const service = await getOrCreateOperationalService(prisma, tenancy, serviceId);

  let result;
  try {
    result = await client.putService(ns, serviceId, marshalSpecForDefinition(definition, { upload_id: marshalUploadId }, resolvedEnv));
  } catch (e) {
    sanitizeMarshalError(e, "Starting the deployment failed");
  }

  // Only mark provisioned once Marshal has actually created the Fly app. A blocked apply
  // (an unresolved `<svc>.url` ref) only persists the spec — no app, no IPs — so setting
  // provisionedAt then would make the domain routes attempt IP allocation on a nonexistent
  // app and 500. `internal_host` is present exactly when the app exists.
  const provisioned = result.state.status !== "blocked" && result.state.outputs.internal_host != null;
  if (service.provisionedAt == null && provisioned) {
    await prisma.deploymentService.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: service.id } },
      data: { provisionedAt: new Date() },
    });
  }

  // Find the build backing this apply. Marshal writes the build record before
  // the PUT returns, so the newest build with our revision is ours; an
  // UNCHANGED re-apply reuses the already-completed build of that revision,
  // which correctly makes the run terminal immediately.
  let build = null;
  try {
    const builds = await client.listBuilds(ns, serviceId, { limit: 10 });
    build = builds.find((candidate) => candidate.revision === result.revision) ?? null;
  } catch (e) {
    // The run row can still be created; refreshRunFromMarshal keeps trying to
    // attach status by revision on subsequent reads via the build id below.
    captureError("deployments-find-build-after-put", e);
  }

  const run = await prisma.deploymentRun.create({
    data: {
      tenancyId: tenancy.id,
      deploymentServiceId: service.id,
      marshalBuildId: build?.id ?? null,
      revision: result.revision,
      serviceUrl: result.state.outputs.url ?? null,
      status: build != null ? mapMarshalBuildStatus(build.status) : "QUEUED",
      error: build?.error ?? null,
      finishedAt: build != null && build.finished_at_millis != null ? new Date(build.finished_at_millis) : null,
      target: "production",
      triggeredBy,
      redactionSecretsEncrypted,
    },
  });

  // Write-through for the service's domains. Failures here must not fail the
  // deploy itself (the run row already exists and the build is running), so a DB/Marshal
  // blip in domain sync must not throw out of startDeployment and lose the run id — the
  // Domains tab surfaces per-domain problems on its own reads.
  try {
    await syncServiceDomainsToMarshal({ tenancy, prisma, serviceDbId: service.id, serviceId, client });
  } catch (e) {
    captureError("deployments-domain-sync-after-deploy", e);
  }

  return { runId: run.id };
}

/**
 * Ensures every domain row of the service is attached in Marshal and mirrors
 * the verification state back into the rows. Domains added in the dashboard
 * before the first deploy only exist as rows (Marshal has no spec to attach
 * them to yet), so this runs on every deploy to push them once the service is
 * provisioned — and it self-heals rows that drifted afterwards.
 * Intentionally tolerant: a domain Marshal rejects (e.g. claimed by another
 * namespace) is recorded as unverified rather than failing the caller — the
 * Domains tab shows per-domain state and errors.
 */
export async function syncServiceDomainsToMarshal(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  serviceDbId: string,
  serviceId: string,
  client: MarshalClient,
}): Promise<void> {
  const { tenancy, prisma, serviceDbId, serviceId, client } = options;
  const ns = marshalNamespaceForTenancy(tenancy);
  const domains = await prisma.deploymentServiceDomain.findMany({
    where: {
      tenancyId: tenancy.id,
      deploymentServiceId: serviceDbId,
    },
  });
  for (const domain of domains) {
    // null = the check didn't complete; the row is left untouched then, so a
    // transient Marshal/network error during a deploy can't clobber a
    // previously-verified domain back to unverified (which would also make
    // `<service>.url` connections resolve to the wrong URL until re-checked).
    let verified: boolean | null = null;
    try {
      const result = await client.putDomain(ns, domain.hostname, serviceId);
      verified = result.verified;
    } catch (e) {
      // NOTHING here may fail the caller — the build is already running, so a domain hiccup
      // must not turn a started deploy into an error. Only 400/409 are real per-domain
      // answers (bad hostname / claimed elsewhere) → record unverified. 404/408/429/5xx are
      // transient or not about this domain → leave the row untouched (verified stays null),
      // so a rate limit can't clobber a genuinely-verified domain back to unverified.
      if (e instanceof MarshalApiError && (e.status === 400 || e.status === 409)) {
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
 * Refreshes a non-terminal run from Marshal (poll-on-read — there is no
 * background poller). No-op when the run is already terminal. The run is
 * considered READY when its build succeeds; machine rollout continues briefly
 * after that and is reported through the service state, not the run.
 */
export async function refreshRunFromMarshal(prisma: PrismaClientTransaction, tenancy: Tenancy, run: {
  id: string,
  status: DeploymentRunStatus,
  marshalBuildId: string | null,
  revision: string | null,
  createdAt: Date,
}, serviceId: string): Promise<void> {
  if (isTerminalRunStatus(run.status)) {
    return;
  }
  const client = getMarshalClientOrThrow();
  const ns = marshalNamespaceForTenancy(tenancy);
  // Backstop so a run whose build never materialized (blocked-then-abandoned, or its build
  // record vanished with a delete+recreate) can't stay non-terminal forever — which would
  // also make every runs-list read re-poll it indefinitely.
  const runAgeMs = Date.now() - run.createdAt.getTime();
  const STUCK_RUN_GRACE_MS = 30 * 60 * 1000;
  const finalizeStuck = async (error: string): Promise<void> => {
    if (runAgeMs < STUCK_RUN_GRACE_MS) return;
    await prisma.deploymentRun.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
      data: { status: "ERROR", error, finishedAt: new Date() },
    });
  };
  let build;
  try {
    const builds = await client.listBuilds(ns, serviceId, { limit: 50 });
    // A run without an attached build id means no build had started when the
    // deploy was accepted (the service was blocked on an unresolved ref, or the
    // post-deploy lookup failed): try to attach by revision — convergence
    // re-applies may have started it since.
    build = run.marshalBuildId != null
      ? builds.find((candidate) => candidate.id === run.marshalBuildId) ?? null
      : builds.find((candidate) => candidate.revision === run.revision) ?? null;
  } catch (e) {
    sanitizeMarshalError(e, "Fetching the deployment status failed");
  }
  if (build == null && run.marshalBuildId == null) {
    // Still no build. If the service is blocked, surface the blocker as the
    // run's failure instead of letting pollers hang on QUEUED forever.
    try {
      const state = await client.getService(ns, serviceId);
      if (state.status === "blocked") {
        await prisma.deploymentRun.update({
          where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
          data: {
            status: "ERROR",
            error: state.error ?? "The service is blocked on an unresolved connection (e.g. a `url` output that needs a verified domain). Fix the blocker and deploy again.",
            finishedAt: new Date(),
          },
        });
        return;
      }
    } catch (e) {
      captureError("deployments-run-refresh-blocked-check", e);
    }
    // Not blocked, yet no build ever appeared for this revision — give up once it's clearly
    // stale rather than re-polling it on every future read.
    await finalizeStuck("The runtime never started a build for this deploy.");
    return;
  }
  if (build == null) {
    // The build record is gone (e.g. the service was deleted and recreated) — leave a fresh
    // run alone, but stop re-polling one that's been stuck this way past the grace window.
    await finalizeStuck("The build for this deploy is no longer available on the runtime.");
    return;
  }
  if (run.marshalBuildId == null) {
    await prisma.deploymentRun.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
      data: { marshalBuildId: build.id },
    });
  }
  const newStatus = mapMarshalBuildStatus(build.status);
  let serviceUrl: string | null | undefined = undefined;
  if (newStatus === "READY") {
    try {
      const state = await client.getService(ns, serviceId);
      serviceUrl = state.outputs.url ?? null;
    } catch (e) {
      // URL mirroring is best-effort; the run's success is the build's.
      captureError("deployments-run-refresh-service-url", e);
    }
  }
  await prisma.deploymentRun.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
    data: {
      status: newStatus,
      ...(serviceUrl !== undefined ? { serviceUrl } : {}),
      error: newStatus === "ERROR" ? (build.error ?? "Deployment failed") : null,
      finishedAt: isTerminalRunStatus(newStatus) ? (build.finished_at_millis != null ? new Date(build.finished_at_millis) : new Date()) : null,
    },
  });
}

export type DnsRecord = MarshalDnsRecord;

export type DeploymentServiceApiShape = {
  id: string,
  type: "container",
  port: number | null,
  min_instances: number | null,
  max_instances: number | null,
  root_directory: string | null,
  // Null = built with Railpack auto-detection rather than a Dockerfile.
  dockerfile_path: string | null,
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
  serviceUrl: string | null,
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
    // Marshal reports full URLs (or null for private services).
    url: run.serviceUrl,
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
  // stay "building" on the board forever. Skipped when Marshal isn't
  // configured so listing still works on unconfigured instances.
  if (latestRun != null && !isTerminalRunStatus(latestRun.status) && getMarshalDeploymentsConfigOrNull() != null) {
    try {
      await refreshRunFromMarshal(prisma, tenancy, latestRun, row.serviceId);
      latestRun = await prisma.deploymentRun.findUnique({
        where: { tenancyId_id: { tenancyId: tenancy.id, id: latestRun.id } },
      });
    } catch (e) {
      // A Marshal hiccup must not take down the whole services list; the board
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

  // The public URL is a verified custom domain, full stop — container services have no
  // platform-assigned URL. Deliberately NOT falling back to the latest run's serviceUrl: that
  // value is frozen when the run goes terminal and never cleared, so a removed domain would be
  // reported as the service URL forever.
  const verifiedPrimary = row.domains.find((d) => d.isPrimary && d.verified) ?? row.domains.find((d) => d.verified);
  const url = verifiedPrimary != null ? `https://${verifiedPrimary.hostname}` : null;

  // KNOWN GAP — `status`/`has_successful_deploy` are derived purely from the build record, so a
  // service whose image builds fine but crash-loops on boot still reports "deployed". Marshal
  // knows the real runtime state (getService returns failed/degraded/idle), but surfacing it
  // here would add a getService round-trip to every board poll (the list endpoint reconciles N
  // services on each read). Similarly, domain `verified` is only refreshed at deploy time and
  // via the per-domain GET, so a cert that issues minutes after deploy leaves `url` null until
  // the user opens the domain panel. Both want a bounded backend↔Marshal reconcile cadence
  // (mirror runtime status + domain verified into the row on a timer / observed_at staleness)
  // rather than an inline call per read. Tracked for a follow-up.

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
    type: "container",
    port: row.port,
    min_instances: row.minInstances,
    max_instances: row.maxInstances,
    root_directory: row.rootDirectory,
    dockerfile_path: row.dockerfilePath,
    provisioned: row.provisionedAt != null,
    status,
    has_successful_deploy: hasSuccessfulDeploy,
    url,
    env,
    domains,
    latest_run: latestRun == null ? null : runToApiShape(latestRun, row.serviceId),
  };
}
