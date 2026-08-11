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

import { getPlanIdForProjectOrNull } from "@/lib/plan-entitlements";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction, globalPrismaClient } from "@/prisma-client";
import type { DeploymentRunStatus, Prisma } from "@/generated/prisma/client";
import { readProjectSecretValue } from "@/lib/project-secrets";
import { DEPLOYMENT_CONNECTION_VALUE_REGEX, DEPLOYMENT_ENV_VAR_KEY_REGEX, DeploymentEnvVarDefinition, DeploymentPortDefinition, DeploymentServiceDefinition, DeploymentServiceType, HEXCLAVE_OUTPUT_KEYS, HEXCLAVE_SERVICE_ID, SERVICE_OUTPUT_KEYS, ServiceOutputKey, deploymentServiceIsPublic, formatConnectionValue, parseConnectionValue, portTransport, soleHttpDeploymentPort } from "@hexclave/shared/dist/deployments";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { PROJECT_SECRET_KEY_REGEX } from "@hexclave/shared/dist/project-secrets";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { MarshalApiError, MarshalClient, MarshalDnsRecord, MarshalEnvValue, MarshalBuild, MarshalServiceState, getMarshalClientOrThrow, getMarshalDeploymentsConfigOrNull, sanitizeMarshalError } from "./marshal-client";

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
 * Parses a DeploymentService row's stored `ports` JSON. Like `env`, the column
 * is only ever written through the sync route (validated against
 * deploymentServiceDefinitionSchema), so a malformed shape is an assertion
 * failure rather than user error. An EMPTY array is legitimate: it is what a row
 * that predates a synced definition holds.
 */
function parseStoredPorts(ports: Prisma.JsonValue, serviceId: string): DeploymentPortDefinition[] {
  // Prisma types the column as never-undefined, but a partial `select` that
  // omits it hands this function undefined at run time.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (ports === null || ports === undefined) return [];
  if (!Array.isArray(ports)) {
    throw new HexclaveAssertionError(`Stored ports of deployment service ${JSON.stringify(serviceId)} is not an array`, { ports });
  }
  return ports.map((entry) => {
    if (!isRecord(entry) || typeof entry.port !== "number") {
      throw new HexclaveAssertionError(`Stored port entry of deployment service ${JSON.stringify(serviceId)} has no numeric port`, { ports });
    }
    const transport = entry.transport ?? "http";
    if (transport !== "http" && transport !== "tcp") {
      throw new HexclaveAssertionError(`Stored port ${entry.port} of deployment service ${JSON.stringify(serviceId)} has invalid transport ${JSON.stringify(transport)}`, { ports });
    }
    return { port: entry.port, public: entry.public === true, transport };
  });
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
  // New writes use entry arrays because Prisma's JSON serializer drops special object keys
  // such as `__proto__`. Keep accepting the original object representation so existing rows
  // remain readable without a data migration.
  const entries: [string, Prisma.JsonValue][] = [];
  if (Array.isArray(env)) {
    for (const tuple of env) {
      if (!Array.isArray(tuple) || tuple.length !== 2) {
        throw new HexclaveAssertionError(`Stored env entry of deployment service ${JSON.stringify(serviceId)} is not a key-value pair`, { env });
      }
      const [envVarKey, entry] = tuple;
      if (typeof envVarKey !== "string") {
        throw new HexclaveAssertionError(`Stored env entry of deployment service ${JSON.stringify(serviceId)} has an invalid key or value`, { env });
      }
      entries.push([envVarKey, entry]);
    }
  } else if (isRecord(env)) {
    for (const [envVarKey, entry] of Object.entries(env)) {
      if (entry === undefined) {
        throw new HexclaveAssertionError(`Stored env entry ${JSON.stringify(envVarKey)} of deployment service ${JSON.stringify(serviceId)} is undefined`, { env });
      }
      entries.push([envVarKey, entry]);
    }
  } else {
    throw new HexclaveAssertionError(`Stored env of deployment service ${JSON.stringify(serviceId)} is neither an entry array nor a legacy record`, { env });
  }
  const result = new Map<string, DeploymentEnvVarDefinition>();
  for (const [envVarKey, entry] of entries) {
    if (!isRecord(entry)) {
      captureError("deployments-stored-env-entry-invalid", new HexclaveAssertionError(`Skipping non-object stored env entry ${JSON.stringify(envVarKey)} of service ${JSON.stringify(serviceId)}`));
      continue;
    }
    result.set(envVarKey, {
      // Unknown type STRINGS are passed through on purpose (hence the cast:
      // the type system can't express "the union, or an unknown string to be
      // rejected later" without widening every consumer). Erasing them here
      // would silently downgrade the entry to a plain var — while
      // normalizeEnvVarConfig's default branch exists precisely to fail loud
      // on them (hand-edited rows, version skew after a rollback).
      type: typeof entry.type === "string" ? entry.type as DeploymentEnvVarDefinition["type"] : undefined,
      value: typeof entry.value === "string" ? entry.value : undefined,
      key: typeof entry.key === "string" ? entry.key : undefined,
    });
  }
  return Object.fromEntries(result);
}

export function definitionFromServiceRow(row: {
  serviceId: string,
  type: string,
  ports: Prisma.JsonValue,
  minInstances: number | null,
  maxInstances: number | null,
  rootDirectory: string | null,
  dockerfilePath: string | null,
  volumeId: string | null,
  volumePath: string | null,
  volumeSizeGb: number | null,
  env: Prisma.JsonValue,
}): DeploymentServiceDefinition {
  if (row.type !== "server" && row.type !== "serverless") {
    throw new HexclaveAssertionError(`Deployment service ${JSON.stringify(row.serviceId)} has invalid type ${JSON.stringify(row.type)}.`);
  }
  return {
    type: row.type,
    // Rows that predate a synced definition have an empty port list. Callers that
    // build a runtime spec must reject that before it reaches Marshal (the deploy
    // route guards it) — an empty array is not a deployable service, only a
    // displayable one.
    ports: parseStoredPorts(row.ports, row.serviceId),
    min_instances: row.minInstances ?? undefined,
    max_instances: row.maxInstances ?? undefined,
    root_directory: row.rootDirectory ?? undefined,
    dockerfile_path: row.dockerfilePath ?? undefined,
    // The three columns are written as a tuple, so a row with only some of them
    // set is corrupt rather than merely partial — treat it as "no volume"
    // instead of synthesizing a definition with a made-up id, path, or size.
    persistent_volumes: row.volumeId !== null && row.volumePath !== null && row.volumeSizeGb !== null
      ? { [row.volumeId]: { path: row.volumePath, size_gb: row.volumeSizeGb } }
      : undefined,
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
/**
 * Always-on instances (`minInstances > 0`) are a paid capability: they hold a
 * machine up around the clock instead of scaling to zero between requests.
 * Free-plan teams may still deploy — they just have to let their services
 * scale to zero.
 *
 * Called from BOTH doors, and it has to be:
 *
 *   - The definition sync is the first server call `hexclave deploy` makes, so
 *     checking there fails before any source is packaged or uploaded and puts
 *     the message at the top of the deploy output. That is UX, not a boundary:
 *     the sync is skippable by anyone calling the API directly.
 *   - The deploy POST is the actual entitlement boundary. It accepts any stored
 *     definition whose `definition_sync_id` still matches, so without a recheck
 *     a team could sync while paid, downgrade, and keep deploying always-on
 *     machines with the old sync id — and, more mundanely, any Free project
 *     that already had `min_instances > 0` stored before this gate shipped
 *     would keep deploying it forever.
 *
 * `volume` is deliberately NOT gated: persistent disks are available on every
 * plan for now. That is a pricing decision, not an oversight — revisit it
 * together with any per-plan storage quota.
 *
 * FUTURE: this gates new DEPLOYS, not machines already running. A team can
 * subscribe, deploy always-on services, cancel, and keep those machines
 * indefinitely, since they never need to re-deploy. Closing that needs a
 * downgrade-time sweep that rescales running services, which belongs with the
 * billing lifecycle rather than here.
 */
export async function assertMinInstancesAllowedByPlan(tenancy: Tenancy, services: Record<string, DeploymentServiceDefinition>): Promise<void> {
  const offending = Object.entries(services)
    .filter(([, definition]) => (definition.min_instances ?? 0) > 0)
    .map(([serviceId]) => serviceId)
    .sort(stringCompare);
  if (offending.length === 0) return;

  // Null = this project isn't plan-gated at all (self-hosted, or plan limits
  // disabled) or the plan couldn't be read. All of those must fail open —
  // deploying can't depend on the billing store being reachable.
  if (await getPlanIdForProjectOrNull(tenancy.project) !== "free") return;

  // The CLI truncates the surfaced message at 1000 chars, and the remedy comes
  // last — so cap the list rather than let a config with many long service ids
  // push the actionable half off the end.
  const shown = offending.slice(0, 5).map((serviceId) => `\`${serviceId}\``);
  const list = offending.length > shown.length
    ? `${shown.join(", ")}, and ${offending.length - shown.length} more`
    : shown.join(", ");
  throw new StatusError(400, [
    `Always-on instances are not available on the Free plan, but ${offending.length === 1 ? `service ${list} sets` : `services ${list} set`} \`minInstances\` above 0.`,
    "",
    "Either:",
    `  - set \`minInstances: 0\` (or remove it) on ${offending.length === 1 ? "that service" : "those services"} in your \`services\` export — ${offending.length === 1 ? "it will" : "they will"} scale to zero when idle and cold-start on the next request; or`,
    "  - upgrade your plan at https://app.hexclave.com to keep instances always on.",
  ].join("\n"));
}

/**
 * Rejects a sync that would shrink a volume, BEFORE anything is packaged or
 * uploaded.
 *
 * Volumes are grow-only (Fly refuses a shrink, and shrinking would destroy
 * tenant data). Marshal enforces that too, but only at apply time — by then
 * `hexclave deploy` has already built the tarball, consumed an upload slot, and
 * started a run, so the author gets the error at the worst possible moment. The
 * previously synced size is right here in the row, so catch it at the door.
 *
 * Marshal's check stays as the backstop: this column can drift from the disk's
 * real size (a sync that succeeded followed by an apply that never converged),
 * and only the runtime knows what Fly actually has.
 */
async function assertNoVolumeShrink(prisma: PrismaClientTransaction, tenancy: Tenancy, services: Record<string, DeploymentServiceDefinition>): Promise<void> {
  const existingRows = await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id, serviceId: { in: Object.keys(services) } },
    select: { serviceId: true, volumeId: true, volumeSizeGb: true },
  });
  const previousVolume = new Map(existingRows.map((row) => [row.serviceId, row]));
  for (const [serviceId, definition] of Object.entries(services)) {
    const previous = previousVolume.get(serviceId) ?? null;
    const next = singleVolume(definition);
    if (previous?.volumeSizeGb == null || next === null || next.sizeGb >= previous.volumeSizeGb) continue;
    // Only compare sizes for the SAME disk. A different id is a different
    // volume, not a shrink of this one — rejecting that would block the very
    // thing volume ids exist for (pointing a service at another disk).
    if (previous.volumeId !== next.volumeId) continue;
    throw new StatusError(400, [
      `Service \`${serviceId}\` already has a ${previous.volumeSizeGb}GB volume, which cannot be shrunk to ${next.sizeGb}GB — disks can only grow.`,
      "",
      // Deliberately does NOT suggest detaching and re-adding smaller: the Fly
      // volume outlives the detach, so that path clears this row's size, slips
      // past this check, and fails at apply time instead — after the upload has
      // been consumed. A smaller disk needs a different volume id.
      `Set its \`sizeGb\` back to at least ${previous.volumeSizeGb}. To start over at a smaller size, give it a new volume id — the existing disk is a separate one and keeps its data.`,
    ].join("\n"));
  }
}

/**
 * A service may declare at most one persistent volume (a Fly machine mounts at
 * most one), so every caller wants the single entry rather than the record.
 */
export function singleVolume(definition: DeploymentServiceDefinition): { volumeId: string, path: string, sizeGb: number } | null {
  const entries = Object.entries(definition.persistent_volumes ?? {});
  if (entries.length === 0) return null;
  return { volumeId: entries[0][0], path: entries[0][1].path, sizeGb: entries[0][1].size_gb };
}

/**
 * Rejects two services claiming one volume id. A volume id names one disk, so
 * two claimants would ask Fly to mount it on two machines; the loser would come
 * up with an empty disk. The CLI checks this too, but a definition can reach
 * the sync route without passing through it.
 *
 * Only the incoming definitions are checked. A row NOT in this sync belongs to a
 * service the config no longer defines — `hexclave deploy` always syncs the whole
 * config, even for `--service-id` — and its id is released by the pass in
 * syncServiceDefinitions. Rejecting on those rows instead would be a dead end:
 * there is no route that deletes a service, so renaming a service that holds a
 * volume would 400 the whole sync forever, telling the user to edit a service
 * their config no longer contains.
 */
function assertNoVolumeIdConflicts(services: Record<string, DeploymentServiceDefinition>): Map<string, string> {
  const claimedBy = new Map<string, string>();
  for (const [serviceId, definition] of Object.entries(services)) {
    const volume = singleVolume(definition);
    if (volume === null) continue;
    const existing = claimedBy.get(volume.volumeId);
    if (existing !== undefined) {
      throw new StatusError(400, `Services \`${existing}\` and \`${serviceId}\` both declare the persistent volume \`${volume.volumeId}\`. A volume is one disk and can only be mounted by one service — give one of them a different id.`);
    }
    claimedBy.set(volume.volumeId, serviceId);
  }
  return claimedBy;
}

export async function syncServiceDefinitions(prisma: PrismaClientTransaction, tenancy: Tenancy, services: Record<string, DeploymentServiceDefinition>, definitionSyncId: string): Promise<void> {
  await assertNoVolumeShrink(prisma, tenancy, services);
  const claimedVolumeIds = assertNoVolumeIdConflicts(services);
  // A custom domain terminates TLS and routes HTTP, so it needs an HTTP port to
  // route TO. A service that declares only TCP ports can never serve one.
  const tcpServiceIds = Object.entries(services)
    .filter(([, definition]) => definition.ports.every((entry) => portTransport(entry) === "tcp"))
    .map(([serviceId]) => serviceId);
  if (tcpServiceIds.length > 0) {
    const serviceWithDomain = await prisma.deploymentService.findFirst({
      where: {
        tenancyId: tenancy.id,
        serviceId: { in: tcpServiceIds },
        domains: { some: {} },
      },
      select: { serviceId: true },
    });
    if (serviceWithDomain !== null) {
      throw new StatusError(400, `Service ${JSON.stringify(serviceWithDomain.serviceId)} has a custom domain, so it must keep an HTTP port to route to. Remove the domain first, or give the service a port with transport: "http".`);
    }
  }
  // Release volume ids BEFORE any upsert writes them. The per-service upserts
  // below run in an arbitrary order within the sync transaction, so moving a volume
  // service B would hit the (tenancyId, volumeId) unique index whenever B
  // happens to be written before A — a move that is valid overall failing on
  // iteration order. Clearing first makes the order irrelevant.
  //
  // Two kinds of row are released: one in this sync whose declared id changed
  // (or went away), and any row — including one this sync does not define —
  // still holding an id that a service here now claims. The second is what makes
  // a service RENAME work: the old service id keeps its row forever (nothing
  // deletes services), so without this its stale claim would block the new name.
  const retainedVolumeIdByService = new Map(Object.entries(services).map(([serviceId, definition]) => [serviceId, singleVolume(definition)?.volumeId ?? null]));
  const heldRows = await prisma.deploymentService.findMany({
    where: {
      tenancyId: tenancy.id,
      volumeId: { not: null },
      OR: [
        { serviceId: { in: [...retainedVolumeIdByService.keys()] } },
        ...(claimedVolumeIds.size > 0 ? [{ volumeId: { in: [...claimedVolumeIds.keys()] } }] : []),
      ],
    },
    select: { serviceId: true, volumeId: true },
  });
  const releasedServiceIds = heldRows
    .filter((row) => row.volumeId !== retainedVolumeIdByService.get(row.serviceId))
    .map((row) => row.serviceId);
  if (releasedServiceIds.length > 0) {
    await prisma.deploymentService.updateMany({
      where: { tenancyId: tenancy.id, serviceId: { in: releasedServiceIds } },
      // The path and size go too: all three are one tuple, and the CHECK
      // constraint refuses an id-less disk paired with a path from another one.
      data: { volumeId: null, volumePath: null, volumeSizeGb: null },
    });
  }

  for (const [serviceId, definition] of Object.entries(services)) {
    const definitionColumns = {
      definitionSyncedAt: new Date(),
      definitionSyncId,
      type: definition.type,
      ports: definition.ports,
      minInstances: definition.min_instances ?? null,
      maxInstances: definition.max_instances ?? null,
      rootDirectory: definition.root_directory ?? null,
      dockerfilePath: definition.dockerfile_path ?? null,
      // Written as a tuple: a definition that drops its volume must clear ALL
      // THREE columns, or a stale remnant would keep mounting a disk the config
      // no longer declares.
      volumeId: singleVolume(definition)?.volumeId ?? null,
      volumePath: singleVolume(definition)?.path ?? null,
      volumeSizeGb: singleVolume(definition)?.sizeGb ?? null,
      // The yup-validated env may contain explicit `undefined` fields, which
      // aren't valid JSON values; filter each entry at this boundary. Spelled
      // out field-by-field so the result is a Prisma-storable entry array
      // without any type assertions. The entry-array representation also preserves
      // object-prototype names through Prisma's JSON serializer.
      env: Object.entries(definition.env).map(([envVarKey, entry]): [string, Record<string, string>] => {
        const stored: Record<string, string> = {};
        if (entry.type !== undefined) stored.type = entry.type;
        if (entry.value !== undefined) stored.value = entry.value;
        if (entry.key !== undefined) stored.key = entry.key;
        return [envVarKey, stored];
      }),
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

export function deploymentRunStatusFromMarshal(build: MarshalBuild, state: MarshalServiceState, revision: string): {
  status: DeploymentRunStatus,
  error: string | null,
} {
  const buildStatus = mapMarshalBuildStatus(build.status);
  if (buildStatus !== "READY") return { status: buildStatus, error: buildStatus === "ERROR" ? (build.error ?? "Deployment failed") : null };

  const converged = state.revision === revision
    && state.target_revision === null
    && (state.status === "running" || state.status === "idle");
  if (converged) return { status: "READY", error: null };

  // A later desired revision owns the service. This run can never converge, even though its
  // image build succeeded, so terminalize it instead of polling forever.
  if (marshalRevisionIsSuperseded(state, revision)) return { status: "CANCELED", error: null };

  if (state.status === "failed" || state.status === "degraded" || state.status === "stopped" || state.status === "blocked") {
    return { status: "ERROR", error: state.error ?? "The image built successfully, but the service rollout failed." };
  }
  return { status: "BUILDING", error: null };
}

function marshalRevisionIsSuperseded(state: MarshalServiceState, revision: string): boolean {
  return (state.target_revision !== null && state.target_revision !== revision)
    || (state.target_revision === null && state.revision !== null && state.revision !== revision);
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
  // `port` is the optional `:<port>` suffix of an `internalUrl` reference,
  // naming which port the URL means on a multi-port service.
  | { type: "connection", serviceId: string, outputKey: string, port: number | null };

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
      const parsed = parseConnectionValue(config.value) ?? throwErr(`The env var ${JSON.stringify(envVarKey)} passed the connection regex but could not be parsed.`);
      return { type: "connection", serviceId: parsed.serviceId, outputKey: parsed.outputKey, port: parsed.port };
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
 * - deployment-service outputs become Marshal `{ ref }`s, validated here first
 *   against the synced target definition (a URL must name a port that exists
 *   and speaks HTTP). `internalUrl`/`internalHost` are deterministic and never block. `url` is immediate for
 *   a public target, while a private target needs a verified custom domain;
 *   if neither exists yet, Marshal reports the service
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
  const existingServices = await prisma.deploymentService.findMany({
    where: { tenancyId: tenancy.id },
    select: { serviceId: true, ports: true },
  });
  const existingServiceIds = new Set(existingServices.map((row) => row.serviceId));
  const existingServicesById = new Map(existingServices.map((row) => [row.serviceId, row]));

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
  const resolvedEnv = new Map<string, MarshalEnvValue>();
  const redactionSecrets = new Set<string>();
  for (const [envVarKey, config] of Object.entries(env)) {
    if (!ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new StatusError(400, `Invalid env var key: ${JSON.stringify(envVarKey)}. Keys must match ${ENV_VAR_KEY_REGEX.toString()}.`);
    }
    const normalized = normalizeEnvVarConfig(envVarKey, config);
    switch (normalized.type) {
      case "plain": {
        resolvedEnv.set(envVarKey, { value: normalized.value });
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
        resolvedEnv.set(envVarKey, { value: secretValue });
        if (secretValue.length > 0) redactionSecrets.add(secretValue);
        break;
      }
      case "connection": {
        const raw = formatConnectionValue(normalized.serviceId, normalized.outputKey, normalized.port);
        // Checked before anything else, including hexclave.* outputs: only a URL
        // names a port, and anywhere else the runtime would silently discard the
        // suffix rather than resolve what the author asked for.
        if (normalized.port !== null && normalized.outputKey !== "internalUrl") {
          throw new StatusError(400, `The env var connection "${raw}" names a port, but only "internalUrl" takes one. Drop the ":${normalized.port}".`);
        }
        if (normalized.serviceId === HEXCLAVE_SERVICE_ID) {
          if (!(HEXCLAVE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
            throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. The hexclave service exposes: ${HEXCLAVE_OUTPUT_KEYS.join(", ")}.`);
          }
          const output = await resolveHexclaveOutputCached(normalized.outputKey, raw);
          resolvedEnv.set(envVarKey, { value: output.value });
          if (output.secret && output.value.length > 0) redactionSecrets.add(output.value);
          break;
        }
        // Static validation first — these can never become resolvable later.
        if (normalized.serviceId === serviceId && normalized.outputKey === "url") {
          throw new StatusError(400, `The env var ${JSON.stringify(envVarKey)} connects to the service's own public URL "${raw}", which cannot exist before the service does. Use ${JSON.stringify(`${serviceId}.internalUrl`)} (called, e.g. internalUrl()) for the service's own address.`);
        }
        if (!existingServiceIds.has(normalized.serviceId) && normalized.serviceId !== serviceId) {
          throw new StatusError(400, `The env var connection "${raw}" points to a service that doesn't exist in this project. Add it to the \`services\` export of your hexclave.config.ts and deploy it first.`);
        }
        if (!(SERVICE_OUTPUT_KEYS as readonly string[]).includes(normalized.outputKey)) {
          throw new StatusError(400, `The env var connection "${raw}" uses an unknown output. Deployment services expose: ${SERVICE_OUTPUT_KEYS.join(", ")}.`);
        }
        const target = existingServicesById.get(normalized.serviceId);
        const targetPorts = target === undefined ? [] : parseStoredPorts(target.ports, normalized.serviceId);
        // A URL names ONE port. The CLI rejects these at config-eval time with
        // better messages; this is the boundary that makes it true regardless of
        // which client synced the definition.
        if (normalized.outputKey === "internalUrl") {
          if (normalized.port === null) {
            if (soleHttpDeploymentPort(targetPorts) === null) {
              throw new StatusError(400, `The env var connection "${raw}" needs exactly one HTTP port on ${JSON.stringify(normalized.serviceId)} to build a URL from, but it declares ${targetPorts.filter((entry) => portTransport(entry) === "http").length}. Name the port you want, or connect with ${JSON.stringify(`${normalized.serviceId}.internalHost`)} and an explicit port.`);
            }
          } else {
            const match = targetPorts.find((entry) => entry.port === normalized.port);
            if (match === undefined) {
              throw new StatusError(400, `The env var connection "${raw}" names port ${normalized.port}, which ${JSON.stringify(normalized.serviceId)} does not declare. Its ports: ${targetPorts.map((entry) => entry.port).join(", ") || "none"}.`);
            }
            if (portTransport(match) !== "http") {
              throw new StatusError(400, `The env var connection "${raw}" names port ${normalized.port}, which is TCP and therefore has no URL. Connect with ${JSON.stringify(`${normalized.serviceId}.internalHost`)} and port ${normalized.port} instead.`);
            }
          }
        }
        // No `length > 0` guard: an empty list used to mean only "no definition
        // synced yet", but it is now also a legitimate portless worker — and
        // neither can ever have a URL, so both belong here rather than blocking
        // later on an unresolvable ref.
        if (normalized.outputKey === "url" && !targetPorts.some((entry) => portTransport(entry) === "http")) {
          const why = targetPorts.length === 0 ? "declares no ports at all" : "declares only TCP ports";
          throw new StatusError(400, `The env var connection "${raw}" requests a URL from a service that ${why}. Connect with ${JSON.stringify(`${normalized.serviceId}.internalHost`)} and an explicit port instead.`);
        }
        // Narrowed by the includes() check above; the map is `satisfies Record<ServiceOutputKey,…>`.
        const marshalOutputKey = SERVICE_OUTPUT_KEY_TO_MARSHAL[normalized.outputKey as ServiceOutputKey];
        // The runtime resolves service-to-service refs itself: internal addresses are
        // deterministic there. A `url` whose private target has no verified domain yet makes
        // the service `blocked` — the run then fails (there is no backend re-apply on domain
        // verification yet; see startDeployment / refreshRunFromMarshal). Prefer internalUrl
        // for service-to-service wiring.
        resolvedEnv.set(envVarKey, { ref: formatConnectionValue(normalized.serviceId, marshalOutputKey, normalized.port) });
        break;
      }
    }
  }

  if (missingSecretKeys.length > 0) {
    const uniqueMissing = [...new Set(missingSecretKeys)].sort(stringCompare);
    throw new StatusError(400, `Missing values for ${uniqueMissing.length === 1 ? "secret" : "secrets"}: ${uniqueMissing.join(", ")}. All of these must be set in the dashboard under Project Settings > Secrets before this service can deploy.`);
  }

  return {
    resolvedEnv: Object.fromEntries(resolvedEnv),
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
  // A "server" is always 0/1 whatever the definition says; the schema and the
  // CLI both reject other bounds, so this only normalizes the defaults rather
  // than overriding a stated intent, and it keeps the spec self-consistent with
  // the type Marshal re-validates against.
  const isServer = definition.type === "server";
  const minInstances = isServer ? 0 : definition.min_instances ?? DEFAULT_MIN_INSTANCES;
  return {
    config: {
      type: definition.type,
      min_instances: minInstances,
      // Default max to at least min: a definition with `minInstances` and no `maxInstances`
      // must not synthesize an invalid spec (max < min) that Marshal 400s after the upload is
      // already consumed. Validation (CLI + schema) also rejects it up front now, but this
      // keeps the spec self-consistent regardless.
      max_instances: isServer ? 1 : definition.max_instances ?? Math.max(minInstances, DEFAULT_MAX_INSTANCES),
      // Passed through verbatim: the runtime derives its ingress from the ports
      // themselves, so there is no separate visibility to keep in step.
      ports: definition.ports.map((entry) => ({ port: entry.port, public: entry.public === true, transport: portTransport(entry) })),
      // Absent = ephemeral container filesystem. Marshal re-validates that a
      // volume implies type "server".
      ...(definition.persistent_volumes !== undefined && Object.keys(definition.persistent_volumes).length > 0
        ? { persistent_volumes: definition.persistent_volumes }
        : {}),
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
  // The `hexclave deploy` this run belongs to, when the caller grouped its
  // services into one (see createDeployment). Null for a standalone deploy of a
  // single service; the dashboard renders those as one-service deployments.
  deploymentId?: string | null,
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

  const runState = build != null
    ? deploymentRunStatusFromMarshal(build, result.state, result.revision)
    : { status: "QUEUED" as const, error: null };
  const run = await prisma.deploymentRun.create({
    data: {
      tenancyId: tenancy.id,
      deploymentServiceId: service.id,
      deploymentId: options.deploymentId ?? null,
      marshalBuildId: build?.id ?? null,
      revision: result.revision,
      serviceUrl: result.state.outputs.url ?? null,
      status: runState.status,
      error: runState.error,
      finishedAt: isTerminalRunStatus(runState.status) ? new Date() : null,
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
 * considered READY only once both the image build and the machine rollout converge.
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
      if (run.revision !== null && marshalRevisionIsSuperseded(state, run.revision)) {
        // A racing PUT may replace the desired spec before this request creates a build.
        // There will never be a build to attach in that case, so waiting for the generic
        // stuck-run timeout would leave an accepted deploy queued for 30 minutes.
        await prisma.deploymentRun.update({
          where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
          data: { status: "CANCELED", error: null, finishedAt: new Date() },
        });
        return;
      }
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
  let runState = { status: mapMarshalBuildStatus(build.status), error: build.error };
  let serviceUrl: string | null | undefined = undefined;
  if (build.status === "succeeded") {
    try {
      const state = await client.getService(ns, serviceId);
      runState = deploymentRunStatusFromMarshal(build, state, run.revision ?? build.revision);
      if (runState.status === "READY") serviceUrl = state.outputs.url ?? null;
    } catch (e) {
      // Keep polling while Marshal's service state is temporarily unavailable. Build success
      // alone is not enough to mark the run READY.
      captureError("deployments-run-refresh-service-state", e);
      runState = { status: "BUILDING", error: null };
    }
  }
  await prisma.deploymentRun.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: run.id } },
    data: {
      status: runState.status,
      ...(serviceUrl !== undefined ? { serviceUrl } : {}),
      error: runState.error,
      finishedAt: isTerminalRunStatus(runState.status) ? new Date() : null,
    },
  });
}

export type DnsRecord = MarshalDnsRecord;

export type DeploymentServiceApiShape = {
  id: string,
  type: DeploymentServiceType,
  // The declared ports. A service is public exactly when one of them is, so the
  // dashboard reads publicness from here rather than from a separate field.
  ports: DeploymentPortDefinition[],
  min_instances: number | null,
  max_instances: number | null,
  root_directory: string | null,
  // Null = built with Railpack auto-detection rather than a Dockerfile.
  dockerfile_path: string | null,
  // Null = no persistent disk (an ephemeral container filesystem). Otherwise a
  // single-entry record keyed by volume id.
  persistent_volumes: Record<string, { path: string, size_gb: number }> | null,
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

// ---------------------------------------------------------------------------
// Deployments: one `hexclave deploy`, holding the per-service runs it triggered.

export type DeploymentApiShape = {
  id: string,
  // The user-facing "#47", monotonic per project.
  number: number,
  // Derived from the runs, never stored: see deploymentStatusFromRuns.
  status: "queued" | "building" | "deployed" | "failed" | "canceled",
  target: string,
  triggered_by: string,
  created_at_millis: number,
  finished_at_millis: number | null,
  // Every service this deploy intended to deploy. A service whose dependency
  // failed never gets a run, so `run` is null for it and the dashboard shows it
  // as skipped rather than omitting it.
  services: { service_id: string, run: DeploymentRunApiShape | null }[],
};

/**
 * A deployment's status, derived from its runs rather than stored, so there is
 * no second copy of the truth to drift.
 *
 * `plannedCount` is what makes this correct mid-deploy. `hexclave deploy`
 * creates the deployment first and then deploys service by service, so a deploy
 * of three services whose first run has just gone READY has one READY run and
 * nothing else. Reading only the runs would call that whole deployment
 * "deployed" and hand it a finish time, then flip it back to "building" — so a
 * deployment with runs still missing is only terminal once something has
 * already failed (the rest are then skipped and will never run).
 *
 * Order matters among the runs themselves: a still-building run outranks an
 * already-failed one, because "still going" is what the reader needs in order to
 * decide whether to wait.
 */
export function deploymentStatusFromRuns(runStatuses: DeploymentRunStatus[], plannedCount: number): DeploymentApiShape["status"] {
  const awaitingRuns = plannedCount > runStatuses.length;
  if (runStatuses.some((status) => status === "BUILDING")) return "building";
  if (runStatuses.some((status) => status === "QUEUED")) return "queued";
  if (runStatuses.some((status) => status === "ERROR")) return "failed";
  if (runStatuses.some((status) => status === "CANCELED")) return "canceled";
  // Every run so far succeeded. If the deploy has services it never started a
  // run for, it is still going — nothing has failed to skip them.
  if (awaitingRuns) return runStatuses.length === 0 ? "queued" : "building";
  return "deployed";
}

/**
 * Creates the deployment that a multi-service `hexclave deploy` groups its runs
 * under. The number is `max + 1` within the tenancy; the caller must supply a
 * transaction (see the route) so the read and the insert are atomic, and the
 * (tenancyId, number) unique index makes the residual race a retry rather than
 * two deployments that print as the same "#47".
 */
export async function createDeployment(prisma: PrismaClientTransaction, tenancy: Tenancy, options: {
  target: string,
  triggeredBy: string,
  plannedServiceIds: string[],
}): Promise<{ id: string, number: number }> {
  const latest = await prisma.deployment.findFirst({
    where: { tenancyId: tenancy.id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const created = await prisma.deployment.create({
    data: {
      tenancyId: tenancy.id,
      number: (latest?.number ?? 0) + 1,
      target: options.target,
      triggeredBy: options.triggeredBy,
      plannedServiceIds: options.plannedServiceIds,
    },
    select: { id: true, number: true },
  });
  return created;
}

export function deploymentToApiShape(deployment: {
  id: string,
  number: number,
  target: string,
  triggeredBy: string,
  createdAt: Date,
  plannedServiceIds: Prisma.JsonValue,
  runs: {
    id: string,
    status: DeploymentRunStatus,
    target: string,
    triggeredBy: string,
    serviceUrl: string | null,
    error: string | null,
    createdAt: Date,
    finishedAt: Date | null,
    service: { serviceId: string },
  }[],
}): DeploymentApiShape {
  const runByServiceId = new Map(deployment.runs.map((run) => [run.service.serviceId, run]));
  // Planned ids come from JSON, so a hand-edited row could hold anything.
  // Fall back to the ids that actually have runs rather than throwing: a
  // deployment that cannot be listed is worse than one listing only its runs.
  const plannedServiceIds = Array.isArray(deployment.plannedServiceIds) && deployment.plannedServiceIds.every((id) => typeof id === "string")
    ? deployment.plannedServiceIds as string[]
    : [...runByServiceId.keys()];
  // Union, planned order first: a run whose service is missing from the plan
  // (the service was renamed mid-deploy, or the row was hand-edited) must still show.
  const serviceIds = [...plannedServiceIds, ...[...runByServiceId.keys()].filter((serviceId) => !plannedServiceIds.includes(serviceId))];
  // Status is computed over the LATEST run per service, matching what `services`
  // below reports. Feeding every run in would let a superseded failure outrank
  // the successful retry that replaced it.
  const latestRuns = [...runByServiceId.values()];
  const status = deploymentStatusFromRuns(latestRuns.map((run) => run.status), serviceIds.length);
  const finishedAtMillis = latestRuns.map((run) => run.finishedAt?.getTime() ?? null);
  return {
    id: deployment.id,
    number: deployment.number,
    status,
    target: deployment.target,
    triggered_by: deployment.triggeredBy,
    created_at_millis: deployment.createdAt.getTime(),
    // Only finished once the deployment itself is terminal AND every run it has
    // is finished: a deployment is done when its slowest service is. A deploy
    // still waiting on runs it never started reports null rather than handing
    // back an earlier service's finish time as the whole deploy's.
    finished_at_millis: status !== "queued" && status !== "building"
      && finishedAtMillis.length > 0 && finishedAtMillis.every((millis) => millis !== null)
      ? Math.max(...finishedAtMillis as number[])
      : null,
    services: serviceIds.map((serviceId) => {
      const run = runByServiceId.get(serviceId);
      return { service_id: serviceId, run: run === undefined ? null : runToApiShape(run, serviceId) };
    }),
  };
}

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

  // Verified custom domains remain the preferred user-facing URL. Public services fall back
  // to Marshal's stable Fly platform URL. Keep using the most recent successful run after a
  // later failed deploy: the previous machines (and their endpoint) can still be serving.
  // A URL needs an HTTP port to route to; the PLATFORM url additionally needs a
  // public one (a private service only gets a URL once its domain verifies).
  const servesHttp = definition.ports.some((entry) => portTransport(entry) === "http");
  const hasPublicPort = deploymentServiceIsPublic(definition.ports);
  const verifiedPrimary = row.domains.find((d) => d.isPrimary && d.verified) ?? row.domains.find((d) => d.verified);
  const latestSuccessfulPublicUrl = servesHttp && hasPublicPort && verifiedPrimary == null && latestRun?.serviceUrl == null
    ? (await prisma.deploymentRun.findFirst({
      where: { tenancyId: tenancy.id, deploymentServiceId: row.id, status: "READY", serviceUrl: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { serviceUrl: true },
    }))?.serviceUrl ?? null
    : null;
  const url = !servesHttp
    ? null
    : verifiedPrimary != null
      ? `https://${verifiedPrimary.hostname}`
      : hasPublicPort ? latestRun?.serviceUrl ?? latestSuccessfulPublicUrl : null;

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
      // formatConnectionValue, not hand-concatenation: dropping the `:port`
      // reports a DIFFERENT reference than the one stored — `api.internalUrl`
      // instead of `api.internalUrl:9090` — which on a multi-port target is not
      // merely lossy but invalid, and is what the dashboard renders.
      value: normalized.type === "plain" ? normalized.value : normalized.type === "connection" ? formatConnectionValue(normalized.serviceId, normalized.outputKey, normalized.port) : null,
      secret_key: normalized.type === "secret" ? normalized.secretKey : null,
    });
  }
  env.sort((a, b) => stringCompare(a.key, b.key));

  const volume = singleVolume(definition);
  return {
    id: row.serviceId,
    type: definition.type,
    ports: definition.ports,
    min_instances: row.minInstances,
    max_instances: row.maxInstances,
    root_directory: row.rootDirectory,
    dockerfile_path: row.dockerfilePath,
    persistent_volumes: volume === null ? null : { [volume.volumeId]: { path: volume.path, size_gb: volume.sizeGb } },
    provisioned: row.provisionedAt != null,
    status,
    has_successful_deploy: hasSuccessfulDeploy,
    url,
    env,
    domains,
    latest_run: latestRun == null ? null : runToApiShape(latestRun, row.serviceId),
  };
}
