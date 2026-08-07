import { createHash } from "node:crypto";
import { computeWebhookToken, type Builder } from "./builds.js";
import { BUILD_TIMEOUT_SECONDS, MACHINE_GUEST, MAX_INSTANCES_CAP, MAX_UPLOAD_BYTES, MAX_VOLUME_SIZE_GB, MIN_VOLUME_SIZE_GB, SOFT_CONCURRENCY_LIMIT, VOLUME_NAME, getConfig, resolveNamespaceOrg } from "./config.js";
import { MarshalError, badRequest, conflict, notFound } from "./errors.js";
import { FlyClient, flyClientForNamespaceOrg, type FlyCertificate, type FlyMachine, type FlyVolume } from "./fly/client.js";
import { fetchAllLogs } from "./logs.js";
import { appNameForService, internalHostForService, networkForNamespace } from "./naming.js";
import { redactSecrets } from "./redact.js";
import { ReconciliationLeaseLostError, withReconciliationLease, type ReconciliationLeaseGuard } from "./reconciliation-lock.js";
import { computeRevision } from "./revision.js";
import { deleteSpec, deleteUpload, deleteValidatedUpload, listBuilds, listDomainClaimsForService, listSpecKeys, readBuild, readDomainClaimVersioned, readSpec, readSpecVersioned, readUpload, releaseDomainClaim, statUpload, writeBuild, writeBuildLog, writeSpec, writeValidatedUpload } from "./store.js";
import { validateSourceArchive } from "./source-archive.js";
import type { DnsRecord, EnvValue, ServiceDomainState, ServiceSpec, ServiceState, StoredBuild, StoredSpec, VolumeConfig } from "./types.js";
import { ulid } from "./ulid.js";

export const SERVICE_TYPE_CONTAINER = "container";
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REF_REGEX = /^([a-zA-Z0-9_][a-zA-Z0-9_-]*)\.([A-Za-z0-9_]+)$/;
const SERVICE_KEY_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/;
const NAMESPACE_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
// upload_id flows into an S3 object key (uploads/<ns>/<id>.tar.gz); validate it so a
// path-traversal id can't escape the prefix. The backend mints these as randomUUIDs.
const UPLOAD_ID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Build ids are ULIDs (Crockford base32, 26 chars); they flow into builds/<ns>/<key>/... keys.
export const BUILD_ID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// Grace on top of the harness's own watchdog before the lazy backstop declares a build dead.
const BUILD_STALE_GRACE_MS = 5 * 60 * 1000;

export function validateNamespace(ns: string): string {
  if (!NAMESPACE_REGEX.test(ns)) throw badRequest(`invalid namespace ${JSON.stringify(ns)}`);
  return ns;
}

export function validateServiceKey(key: string): string {
  if (!SERVICE_KEY_REGEX.test(key)) throw badRequest(`invalid service key ${JSON.stringify(key)}`);
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function validateServiceSpec(body: unknown): ServiceSpec {
  const record = asRecord(body);
  if (record === null) throw badRequest("request body must be a ServiceSpec object");
  const config = asRecord(record.config);
  if (config === null) throw badRequest("config is required");
  const minInstances = config.min_instances;
  const maxInstances = config.max_instances;
  const port = config.port;
  if (typeof minInstances !== "number" || !Number.isInteger(minInstances) || minInstances < 0) throw badRequest("config.min_instances must be a non-negative integer");
  if (typeof maxInstances !== "number" || !Number.isInteger(maxInstances) || maxInstances < 1) throw badRequest("config.max_instances must be a positive integer");
  if (maxInstances < minInstances) throw badRequest("config.max_instances must be >= config.min_instances");
  if (maxInstances > MAX_INSTANCES_CAP) throw badRequest(`config.max_instances must be <= ${MAX_INSTANCES_CAP}`);
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw badRequest("config.port must be a valid port number");

  // A Fly volume attaches to at most one machine, so a volume-backed service cannot have a
  // fleet: max_instances must be exactly 1. min_instances 0 is still fine — a stopped
  // machine keeps its volume and autostarts with it (smoke-verified).
  let volume: VolumeConfig | undefined;
  if (config.volume !== undefined && config.volume !== null) {
    const volumeRecord = asRecord(config.volume);
    if (volumeRecord === null) throw badRequest("config.volume must be an object of { path, size_gb }");
    const volumePath = volumeRecord.path;
    const sizeGb = volumeRecord.size_gb;
    if (typeof volumePath !== "string" || volumePath === "" || volumePath.length > 512) throw badRequest("config.volume.path must be a non-empty string of at most 512 characters");
    // The path becomes a mount point inside the container. Require a normalized ABSOLUTE
    // path: relative or dot-laden paths are ambiguous against the image's WORKDIR, and
    // mounting over "/" would shadow the whole image.
    // eslint-disable-next-line no-control-regex
    if (!volumePath.startsWith("/") || volumePath === "/" || volumePath.endsWith("/") || volumePath.includes("\\") || /[\x00-\x1f]/.test(volumePath) || volumePath.split("/").slice(1).some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw badRequest('config.volume.path must be a normalized absolute path inside the container (e.g. "/data") — no trailing slash, no "." or ".." segments, no backslashes or control characters');
    }
    if (typeof sizeGb !== "number" || !Number.isInteger(sizeGb) || sizeGb < MIN_VOLUME_SIZE_GB || sizeGb > MAX_VOLUME_SIZE_GB) {
      throw badRequest(`config.volume.size_gb must be an integer between ${MIN_VOLUME_SIZE_GB} and ${MAX_VOLUME_SIZE_GB}`);
    }
    if (maxInstances !== 1) throw badRequest("config.max_instances must be 1 when config.volume is set (a Fly volume can only be attached to one instance)");
    volume = { path: volumePath, size_gb: sizeGb };
  }

  const source = asRecord(record.source);
  if (source === null) throw badRequest("source is required");
  const hasUploadId = typeof source.upload_id === "string" && source.upload_id !== "";
  const hasImage = typeof source.image === "string" && source.image !== "";
  if (hasUploadId === hasImage) throw badRequest("source must be exactly one of { upload_id } or { image }");
  if (hasUploadId && !UPLOAD_ID_REGEX.test(source.upload_id as string)) throw badRequest("source.upload_id must be a UUID");
  // Optional Dockerfile location within the tarball. It flows into the builder harness (as
  // a quoted shell env var and a buildctl --opt), so reject anything that isn't a plain
  // NORMALIZED relative path: absolute paths, traversal, "."/empty segments, backslashes,
  // control chars. Normalization matters beyond safety: dockerfile_path is part of the
  // revision hash, so "./Dockerfile" and "Dockerfile" would otherwise be two different
  // revisions of an identical build.
  let dockerfilePath: string | undefined;
  if (hasUploadId && source.dockerfile_path !== undefined) {
    const value = source.dockerfile_path;
    if (typeof value !== "string" || value === "" || value.length > 512) throw badRequest("source.dockerfile_path must be a non-empty string of at most 512 characters");
    // eslint-disable-next-line no-control-regex
    if (value.startsWith("/") || value.includes("\\") || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") || /[\x00-\x1f]/.test(value)) {
      throw badRequest("source.dockerfile_path must be a normalized relative path inside the source tarball (no leading \"/\", no \".\" or \"..\" segments, no backslashes or control characters)");
    }
    dockerfilePath = value;
  } else if (source.dockerfile_path !== undefined) {
    throw badRequest("source.dockerfile_path is only valid together with source.upload_id");
  }

  const env = asRecord(record.env);
  if (env === null) throw badRequest("env is required (use {} for no env vars)");
  const validatedEnv = new Map<string, EnvValue>();
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_REGEX.test(key)) throw badRequest(`invalid env var key ${JSON.stringify(key)}`);
    const envValue = asRecord(value);
    if (envValue === null) throw badRequest(`env.${key} must be { value } or { ref }`);
    const hasValue = typeof envValue.value === "string";
    const hasRef = typeof envValue.ref === "string";
    if (hasValue === hasRef) throw badRequest(`env.${key} must be exactly one of { value } or { ref }`);
    if (hasRef && !REF_REGEX.test(envValue.ref as string)) throw badRequest(`env.${key}.ref must look like "<service_key>.<output_key>"`);
    validatedEnv.set(key, hasValue ? { value: envValue.value as string } : { ref: envValue.ref as string });
  }

  return {
    // Key order is canonical here too (see the source note below). `volume` is only present
    // when set, so a volumeless spec hashes exactly as it did before this field existed —
    // computeRevision mirrors that same conditional spread.
    config: { min_instances: minInstances, max_instances: maxInstances, port: port, ...(volume !== undefined ? { volume } : {}) },
    // Key order is fixed here on purpose: computeRevision hashes the JSON serialization of
    // this object, so construction must stay canonical.
    source: hasUploadId
      ? { upload_id: source.upload_id as string, ...(dockerfilePath !== undefined ? { dockerfile_path: dockerfilePath } : {}) }
      : { image: source.image as string },
    env: Object.fromEntries(validatedEnv),
  };
}

// ---------------------------------------------------------------------------
// Env ref resolution

type ResolvedEnv =
  | { ok: true, env: Record<string, string> }
  | { ok: false, blockedRefs: string[] };

// internal_host/internal_url are pure functions of the service name, so they resolve even
// before the target exists (this is what keeps mutually-referencing services from
// deadlocking). Only `url` depends on external state (a verified domain) and can block.
async function resolveEnv(fly: FlyClient, ns: string, env: Record<string, EnvValue>): Promise<ResolvedEnv> {
  const { envId } = getConfig();
  const resolved = new Map<string, string>();
  const blockedRefs: string[] = [];
  const urlCache = new Map<string, string | null>();

  for (const [key, value] of Object.entries(env)) {
    if ("value" in value) {
      resolved.set(key, value.value);
      continue;
    }
    const match = REF_REGEX.exec(value.ref);
    if (match === null) {
      blockedRefs.push(value.ref);
      continue;
    }
    const [, targetKey, outputKey] = match;
    switch (outputKey) {
      case "internal_host": {
        resolved.set(key, internalHostForService(envId, ns, targetKey));
        break;
      }
      case "internal_url": {
        resolved.set(key, `http://${internalHostForService(envId, ns, targetKey)}`);
        break;
      }
      case "url": {
        if (!urlCache.has(targetKey)) {
          urlCache.set(targetKey, await computeServiceUrl(fly, ns, targetKey));
        }
        const url = urlCache.get(targetKey) ?? null;
        if (url === null) {
          blockedRefs.push(value.ref);
        } else {
          resolved.set(key, url);
        }
        break;
      }
      default: {
        // Unknown output keys block rather than 400 so adding output keys later is
        // backward-compatible: the backend re-applies once the runtime learns them.
        blockedRefs.push(value.ref);
      }
    }
  }
  if (blockedRefs.length > 0) return { ok: false, blockedRefs };
  return { ok: true, env: Object.fromEntries(resolved) };
}

function certificateIsVerified(certificate: FlyCertificate): boolean {
  return certificate.clientStatus === "Ready";
}

async function computeServiceUrl(fly: FlyClient, ns: string, key: string): Promise<string | null> {
  const { envId } = getConfig();
  const certificates = await fly.listCertificates(appNameForService(envId, ns, key));
  const verified = certificates.filter(certificateIsVerified).map((certificate) => certificate.hostname).sort();
  return verified.length > 0 ? `https://${verified[0]}` : null;
}

// ---------------------------------------------------------------------------
// Machine reconciliation

function isServerful(spec: ServiceSpec): boolean {
  return spec.config.min_instances === 1 && spec.config.max_instances === 1;
}

function desiredMachineCount(spec: ServiceSpec): number {
  return isServerful(spec) ? 1 : spec.config.max_instances;
}

function pinnedMachineCount(spec: ServiceSpec): number {
  return isServerful(spec) ? 1 : spec.config.min_instances;
}

function machineConfigForSlot(options: {
  imageRef: string,
  spec: ServiceSpec,
  revision: string,
  ns: string,
  key: string,
  slot: number,
  env: Record<string, string>,
  volumeId: string | null,
}): Record<string, unknown> {
  const pinned = options.slot < pinnedMachineCount(options.spec);
  const volume = options.spec.config.volume;
  const config = {
    image: options.imageRef,
    guest: MACHINE_GUEST,
    env: options.env,
    // Only slot 0 can carry the volume, and a volume-backed spec is single-slot anyway
    // (max_instances === 1, enforced in validateServiceSpec). The volume id is part of the
    // hashed config on purpose: if the volume were ever replaced, the machine must roll onto
    // the new one rather than silently keep the old mount.
    ...(volume !== undefined && options.volumeId !== null && options.slot === 0
      ? { mounts: [{ volume: options.volumeId, path: volume.path }] }
      : {}),
    metadata: {
      hexclave_ns: options.ns,
      hexclave_key: options.key,
      hexclave_revision: options.revision,
      hexclave_slot: String(options.slot),
    },
    restart: { policy: "on-failure", max_retries: 2 },
    services: [{
      protocol: "tcp",
      internal_port: options.spec.config.port,
      // Pinned machines never autostop; the rest scale to zero and Fly Proxy autostarts
      // them on demand (only *existing* machines get autostarted, which is why the full
      // max_instances fleet is pre-created).
      autostop: pinned ? "off" : "stop",
      autostart: true,
      ports: [
        // Port 80 stays plain HTTP (no force_https) because flycast's internal_url is http.
        { port: 80, handlers: ["http"] },
        { port: 443, handlers: ["tls", "http"] },
      ],
      concurrency: { type: "requests", soft_limit: SOFT_CONCURRENCY_LIMIT },
    }],
  };
  // The config hash makes re-applies cheap no-ops and catches resolved-ref drift that the
  // revision (hashed over UNresolved env) deliberately ignores.
  const hash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);
  return { ...config, metadata: { ...config.metadata, hexclave_config_hash: hash } };
}

// Fly does NOT enforce unique volume names within an app. The reconciliation lease prevents
// Marshal replicas from creating concurrently, but a process can still die after Fly accepts
// a create and before the bucket records the outcome. These helpers make recovery
// DETERMINISTIC — the currently-attached volume first, then the oldest id — so every later
// apply converges on the same disk. Choosing arbitrarily is the dangerous case: it would roll
// the machine onto another volume and the service would come up with an empty disk, which
// reads to the tenant as total data loss. Volumes being destroyed are never candidates.
export function candidateVolumes(volumes: FlyVolume[]): FlyVolume[] {
  return volumes
    .filter((candidate) => candidate.name === VOLUME_NAME && candidate.state !== "destroying" && candidate.state !== "pending_destruction")
    .sort((a, b) => {
      if ((a.attached_machine_id !== null) !== (b.attached_machine_id !== null)) return a.attached_machine_id !== null ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

export function selectCanonicalVolume(volumes: FlyVolume[]): FlyVolume | null {
  const candidates = candidateVolumes(volumes);
  return candidates.length === 0 ? null : candidates[0];
}

// Idempotently brings the service's single volume to the configured size, returning its id.
// Created BEFORE any machine: Fly places a machine on its volume's host, and creating the
// machine first would usually land it on a different host (then the mount fails).
async function ensureVolume(fly: FlyClient, appName: string, volume: VolumeConfig, lease: ReconciliationLeaseGuard): Promise<string> {
  const config = getConfig();
  const candidates = candidateVolumes(await fly.listVolumes(appName));
  if (candidates.length === 0) {
    await lease.assertOwned();
    const created = await fly.createVolume(appName, { name: VOLUME_NAME, region: config.fly.region, size_gb: volume.size_gb });
    await fly.waitForVolumeListed(appName, created.id);
    // Re-list and re-select rather than trusting our own create. Two concurrent
    // applies can both see an empty list and both create a volume (Fly does not
    // enforce unique names), and if each then mounted the disk it made, the service
    // would come up as two machines backed by DIVERGENT data — writes split across
    // two disks, unmergeable. Re-selecting with the same deterministic rule makes
    // both applies converge on one canonical volume; the loser's create is orphaned
    // (logged below), and whichever apply gets there second is refused by Fly's
    // "volume already claimed" 412 instead of silently diverging.
    const canonical = selectCanonicalVolume(await fly.listVolumes(appName));
    if (canonical === null) return created.id; // list raced the create; ours is all we know of
    if (canonical.id !== created.id) {
      console.error(`volume create race on ${appName}: adopted ${canonical.id}, orphaning ${created.id} (needs manual cleanup)`);
      // The orphan may be smaller than requested; the adopted one still has to grow.
      if (volume.size_gb > canonical.size_gb) {
        await lease.assertOwned();
        await fly.extendVolume(appName, canonical.id, volume.size_gb);
      }
    }
    return canonical.id;
  }
  const existing = candidates[0];
  if (volume.size_gb > existing.size_gb) {
    await lease.assertOwned();
    await fly.extendVolume(appName, existing.id, volume.size_gb);
  } else if (volume.size_gb < existing.size_gb) {
    // Fly volumes are grow-only, and shrinking would mean destroying tenant data. Fail the
    // deploy rather than silently ignoring the requested size: a no-op here would leave the
    // config claiming a size the service does not have and the tenant billed for the larger
    // disk, with nothing anywhere reporting the divergence.
    throw badRequest(
      `the volume is already ${existing.size_gb}GB and cannot be shrunk to ${volume.size_gb}GB (disks can only grow). `
      + `Set the volume size back to at least ${existing.size_gb}GB, or remove the volume from this service and redeploy to detach it — the existing disk is kept either way.`,
    );
  }
  return existing.id;
}

// Mount sets are compared by (volume id, path), order-insensitively. Any difference means
// the machine has to be recreated rather than updated — see the call site.
function mountsDiffer(a: { volume: string, path: string }[], b: { volume: string, path: string }[]): boolean {
  if (a.length !== b.length) return true;
  const key = (mount: { volume: string, path: string }) => `${mount.volume}\u0000${mount.path}`;
  const inA = new Set(a.map(key));
  return b.some((mount) => !inA.has(key(mount)));
}

async function applyMachines(fly: FlyClient, stored: StoredSpec, imageRef: string, env: Record<string, string>, lease: ReconciliationLeaseGuard): Promise<void> {
  const config = getConfig();
  const appName = appNameForService(config.envId, stored.ns, stored.key);
  const network = networkForNamespace(config.envId, stored.ns);
  await lease.assertOwned();
  await fly.ensureApp(appName, network);
  await lease.assertOwned();
  await fly.ensureFlycastIp(appName, network);

  const volume = stored.spec.config.volume;
  const volumeId = volume === undefined ? null : await ensureVolume(fly, appName, volume, lease);

  const machines = await fly.listMachines(appName);
  const bySlot = new Map<number, FlyMachine>();
  let extras: FlyMachine[] = [];
  for (const machine of machines) {
    const slot = Number(machine.config.metadata?.hexclave_slot);
    if (Number.isInteger(slot) && slot >= 0 && !bySlot.has(slot)) {
      bySlot.set(slot, machine);
    } else {
      extras.push(machine);
    }
  }

  // A volume can only be claimed by one machine, so any leftover machine still holding it
  // must go BEFORE the slot loop tries to mount it — otherwise slot 0's create/update gets
  // Fly's 412 "volume already claimed", applyMachines throws before reaching the destroy
  // loop below, and every retry reproduces it identically (a permanently wedged service).
  // Scoped to claim-holders only: reordering the whole destroy loop would break the rolling
  // guarantee documented below.
  if (volumeId !== null) {
    const holdsVolume = (machine: FlyMachine) => (machine.config.mounts ?? []).some((mount) => mount.volume === volumeId);
    const claimHolders = extras.filter(holdsVolume);
    for (const machine of claimHolders) {
      await lease.assertOwned();
      await fly.destroyMachine(appName, machine.id);
    }
    extras = extras.filter((machine) => !holdsVolume(machine));
  }

  const count = desiredMachineCount(stored.spec);
  // Rolling, one machine at a time with a started-wait between (deploy decision #6): a bad
  // image fails on slot 0 and leaves the rest serving the old revision.
  for (let slot = 0; slot < count; slot++) {
    const desired = machineConfigForSlot({ imageRef, spec: stored.spec, revision: stored.revision, ns: stored.ns, key: stored.key, slot, env, volumeId });
    const desiredHash = (desired.metadata as Record<string, string>).hexclave_config_hash;
    let existing = bySlot.get(slot);
    bySlot.delete(slot);

    // A machine's MOUNTS cannot be changed in place. Fly places a machine on its volume's
    // host, so an already-placed machine can't adopt a volume that was created afterwards:
    // real Fly rejects the update with `400 invalid_argument: volume does not exist`, even
    // once the volume is listed and `created` (verified against real Fly). Left to
    // the update path, adding a volume to a deployed service would fail identically on every
    // retry and wedge it forever. Destroy first so the branch below recreates it on the
    // volume's host. Detaching is recreated too: the reverse transition is equally unproven,
    // and the volume itself always survives (smoke Q3a).
    if (existing !== undefined && mountsDiffer(existing.config.mounts ?? [], desired.mounts as { volume: string, path: string }[] | undefined ?? [])) {
      await lease.assertOwned();
      await fly.destroyMachine(appName, existing.id);
      existing = undefined;
    }

    const existingStarted = existing !== undefined && (existing.state === "started" || existing.state === "starting");
    // Config-hash match short-circuits — but only when the machine is actually up. A pinned
    // (autostop:"off") slot that crash-looped to `stopped` will never be restarted by Fly
    // Proxy, so a same-spec reconcile must still boot it; otherwise an always-on service
    // stays down forever. Autostoppable slots are meant to be stopped, so leave those.
    const pinned = slot < pinnedMachineCount(stored.spec);
    if (existing !== undefined && existing.config.metadata?.hexclave_config_hash === desiredHash && (existingStarted || !pinned)) continue;
    if (existing !== undefined && existing.config.metadata?.hexclave_config_hash === desiredHash) {
      // Hash matches but a pinned machine is stopped: just start it, no config churn.
      try {
        await lease.assertOwned();
        await fly.startMachine(appName, existing.id);
      } catch (error) {
        if (error instanceof ReconciliationLeaseLostError) throw error;
        // Already booting / raced — the wait below arbitrates.
      }
      await fly.waitForMachineState(appName, existing.id, "started", { instanceId: existing.instance_id, totalTimeoutSeconds: 120 });
      continue;
    }
    if (existing !== undefined) {
      const wasStopped = existing.state !== "started" && existing.state !== "starting";
      await lease.assertOwned();
      const updated = await fly.updateMachine(appName, existing.id, desired);
      if (wasStopped) {
        // Updating a stopped machine doesn't reliably boot it; start explicitly so the
        // started-wait below actually gates the roll (autostop re-stops it when idle).
        try {
          await lease.assertOwned();
          await fly.startMachine(appName, updated.id);
        } catch (error) {
          if (error instanceof ReconciliationLeaseLostError) throw error;
          // Racing the update-triggered boot is fine — the wait below is the arbiter.
        }
      }
      await fly.waitForMachineState(appName, updated.id, "started", { instanceId: updated.instance_id, totalTimeoutSeconds: 120 });
    } else {
      await lease.assertOwned();
      const created = await fly.createMachine(appName, {
        name: `${stored.key.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20)}-${slot}`,
        region: config.fly.region,
        config: desired,
      });
      await fly.waitForMachineState(appName, created.id, "started", { instanceId: created.instance_id, totalTimeoutSeconds: 120 });
    }
  }
  for (const machine of [...bySlot.values(), ...extras]) {
    await lease.assertOwned();
    await fly.destroyMachine(appName, machine.id);
  }
}

// ---------------------------------------------------------------------------
// PUT /services/{key}

export type ApplyResult = { revision: string, changed: boolean, state: ServiceState };

async function claimDesiredSpec(ns: string, key: string, spec: ServiceSpec, revision: string, now: number): Promise<{
  stored: StoredSpec,
  changed: boolean,
  etag: string,
  archive: Uint8Array | null,
}> {
  const validatedArchives = new Map<string, Uint8Array>();
  for (let attempt = 0; attempt < 10; attempt++) {
    const previousVersion = await readSpecVersioned(ns, key);
    const previous = previousVersion?.value ?? null;
    const changed = previous === null || previous.revision !== revision;
    const stored: StoredSpec = {
      ns,
      key,
      // Unchanged re-PUTs keep the stored source: it may already be rewritten to { image }
      // by a completed build, and reverting it to { upload_id } would orphan the deploy.
      spec: changed ? spec : previous.spec,
      revision,
      created_at_millis: previous?.created_at_millis ?? now,
      updated_at_millis: Date.now(),
      last_apply_error: changed ? null : previous.last_apply_error,
    };
    let archive: Uint8Array | null = null;
    if ("upload_id" in stored.spec.source) {
      const uploadId = stored.spec.source.upload_id;
      archive = validatedArchives.get(uploadId) ?? null;
      if (archive === null) {
        const upload = await statUpload(ns, uploadId);
        if (upload === null) throw badRequest(`upload ${JSON.stringify(uploadId)} does not exist (expired, already consumed, or never uploaded)`);
        if (upload.sizeBytes > MAX_UPLOAD_BYTES) throw badRequest(`upload is ${upload.sizeBytes} bytes; the maximum is ${MAX_UPLOAD_BYTES}`);
        archive = await readUpload(ns, uploadId);
        if (archive === null) throw badRequest(`upload ${JSON.stringify(uploadId)} disappeared before it could be consumed`);
        validateSourceArchive(archive);
        validatedArchives.set(uploadId, archive);
      }
    }
    const etag = await writeSpec(stored, previousVersion === null ? { ifNoneMatch: true } : { ifMatch: previousVersion.etag });
    if (etag !== null) return { stored, changed, etag, archive };
  }
  throw conflict(`service ${JSON.stringify(key)} was updated too frequently; retry the request`);
}

async function stateAfterSpecWrite(ns: string, key: string, stored: StoredSpec, previousEtag: string): Promise<ServiceState> {
  const etag = await writeSpec(stored, { ifMatch: previousEtag });
  if (etag !== null) return await getServiceState(ns, key, stored);
  // Another request (or a delete) owns the desired state now. Never resurrect/overwrite it.
  return await getServiceState(ns, key);
}

async function specIsStillOwned(ns: string, key: string, etag: string): Promise<boolean> {
  return (await readSpecVersioned(ns, key))?.etag === etag;
}

export async function applyServiceSpec(ns: string, key: string, spec: ServiceSpec, builder: Builder): Promise<ApplyResult> {
  return await withReconciliationLease(ns, key, async (lease) => await applyServiceSpecWithLease(ns, key, spec, builder, lease));
}

async function applyServiceSpecWithLease(ns: string, key: string, spec: ServiceSpec, builder: Builder, lease: ReconciliationLeaseGuard): Promise<ApplyResult> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const revision = computeRevision(spec);
  const now = Date.now();
  const claimed = await claimDesiredSpec(ns, key, spec, revision, now);
  const { stored, changed } = claimed;
  const ownedSpecEtag = claimed.etag;

  // Unresolvable refs: persist the spec and report blocked WITHOUT touching machines or
  // starting builds — the backend re-applies when the blocking output appears.
  const resolved = await resolveEnv(fly, ns, stored.spec.env);
  if (!resolved.ok) {
    return { revision, changed, state: await getServiceState(ns, key, stored) };
  }

  // A build starts whenever the stored source is still an upload and no build exists for
  // this revision yet — NOT merely when the revision changed: a spec that arrived blocked
  // starts its build on the unblocking re-apply (changed === false there). A failed build
  // of the same revision is deliberately not retried (retries come with a fresh upload and
  // therefore a new revision). Builds started BEFORE this spec's creation don't count: a
  // delete+recreate resets created_at, so a stale record from a previous incarnation (or a
  // failed pre-delete build) must not suppress the fresh service's build.
  const recentBuilds = await listBuilds(ns, key, { limit: 10 });
  const buildForRevision = recentBuilds.find(
    (build) => build.revision === revision && build.started_at_millis >= stored.created_at_millis,
  ) ?? null;
  const needsBuild = "upload_id" in stored.spec.source && buildForRevision === null;
  if (needsBuild && "upload_id" in stored.spec.source) {
    const uploadId = stored.spec.source.upload_id;
    const archive = claimed.archive;
    if (archive === null) throw new Error("claimed upload-sourced spec was not validated");
    if (!await specIsStillOwned(ns, key, ownedSpecEtag)) {
      return { revision, changed, state: await getServiceState(ns, key) };
    }

    // The service app must exist BEFORE the build: registry.fly.io only
    // accepts pushes to repositories of existing apps (real-Fly-verified —
    // pushing first fails with "app repository not found").
    const appName = appNameForService(config.envId, ns, key);
    const network = networkForNamespace(config.envId, ns);
    await lease.assertOwned();
    await fly.ensureApp(appName, network);
    await lease.assertOwned();
    await fly.ensureFlycastIp(appName, network);

    // The record is written as "running" BEFORE the builder starts: completion (webhook or
    // mock) may land at any moment after startBuild, and a blind write here afterwards
    // could clobber a terminal record.
    const build: StoredBuild = {
      // Minted from `now` (not the current clock): `now` is what lands in started_at_millis,
      // and listBuilds' ULID prefilter requires the id time never to run ahead of it.
      id: ulid(now),
      ns,
      key,
      revision,
      status: "running",
      has_logs: true,
      error: null,
      started_at_millis: now,
      finished_at_millis: null,
      builder_app: null,
      builder_machine_id: null,
      image: null,
      upload_id: uploadId,
    };
    // Copy the validated bytes to a build-specific key that the client cannot overwrite.
    // The original presigned PUT remains valid until expiry, so building from it would leave
    // a validation-to-extraction race even after strict tar validation.
    await writeValidatedUpload(ns, build.id, archive);
    await writeBuild(build);
    try {
      const started = await builder.startBuild({
        ns,
        key,
        buildId: build.id,
        revision,
        appName: appNameForService(config.envId, ns, key),
        uploadId,
        dockerfilePath: stored.spec.source.dockerfile_path ?? null,
      });
      if (started.builderApp !== null || started.builderMachineId !== null) {
        // Attach the builder coordinates (live-log proxy + stale-build backstop need
        // them) — but only if the build hasn't already reached a terminal state.
        const current = await readBuild(ns, key, build.id);
        if (current !== null && (current.status === "queued" || current.status === "running")) {
          await writeBuild({ ...current, builder_app: started.builderApp, builder_machine_id: started.builderMachineId });
        }
      }
    } catch (error) {
      const current = await readBuild(ns, key, build.id);
      if (current !== null && (current.status === "queued" || current.status === "running")) {
        await writeBuild({ ...current, status: "failed", error: "starting the build failed", finished_at_millis: Date.now() });
      }
      await deleteValidatedUploadBestEffort(ns, build.id);
      throw error;
    }
    return { revision, changed, state: await getServiceState(ns, key, stored) };
  }

  // The stored source may still be { upload_id } even though its build already succeeded —
  // if completeBuild crashed before rewriting the spec, or a concurrent apply clobbered it
  // (see the CAS note on writeSpec). Adopt the built image so the service still converges
  // instead of no-oping forever. needsBuild was false here, so buildForRevision is set when
  // the source is an upload.
  if ("upload_id" in stored.spec.source && buildForRevision?.status === "succeeded" && buildForRevision.image !== null) {
    stored.spec = { ...stored.spec, source: { image: buildForRevision.image } };
  }

  if (changed && "image" in spec.source) {
    // No-artifact revision (rescale / env edit / direct { image } deploy): record an
    // immediate succeeded build with has_logs: false so the build history stays complete.
    await writeBuild({
      id: ulid(now),
      ns,
      key,
      revision,
      status: "succeeded",
      has_logs: false,
      error: null,
      started_at_millis: now,
      finished_at_millis: now,
      builder_app: null,
      builder_machine_id: null,
      image: spec.source.image,
      upload_id: null,
    });
  }

  // Reaching here means the effective source is an image (either given directly, or an
  // unchanged spec whose build already completed). A still-building unchanged spec has an
  // { upload_id } source — nothing to apply yet.
  const source = stored.spec.source;
  if ("image" in source) {
    if (!await specIsStillOwned(ns, key, ownedSpecEtag)) {
      return { revision, changed, state: await getServiceState(ns, key) };
    }
    try {
      await applyMachines(fly, stored, source.image, resolved.env, lease);
      stored.last_apply_error = null;
    } catch (error) {
      if (error instanceof ReconciliationLeaseLostError) throw error;
      stored.last_apply_error = error instanceof Error ? `deploy failed: ${error.message}` : "deploy failed";
    }
  }
  return { revision, changed, state: await stateAfterSpecWrite(ns, key, stored, ownedSpecEtag) };
}

// ---------------------------------------------------------------------------
// Build completion (webhook + mock builder both land here)

export async function completeBuild(options: {
  ns: string,
  key: string,
  buildId: string,
  status: "succeeded" | "failed",
  metadataJson: string | null,
  errorText: string | null,
}): Promise<void> {
  await withReconciliationLease(options.ns, options.key, async (lease) => await completeBuildWithLease(options, lease));
}

async function completeBuildWithLease(options: {
  ns: string,
  key: string,
  buildId: string,
  status: "succeeded" | "failed",
  metadataJson: string | null,
  errorText: string | null,
}, lease: ReconciliationLeaseGuard): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(options.ns));
  const build = await readBuild(options.ns, options.key, options.buildId);
  if (build === null) throw notFound(`build ${options.buildId} not found`);
  if (build.status !== "queued" && build.status !== "running") return; // idempotent replay

  const appName = appNameForService(config.envId, options.ns, options.key);

  if (options.status === "failed") {
    // Persist the durable log BEFORE the terminal record: the logs route serves the bucket
    // object once the record is terminal, so writing the record first opens a window where
    // it reports complete:true with no lines yet.
    const failed: StoredBuild = { ...build, status: "failed", error: truncateError(options.errorText) ?? "build failed", finished_at_millis: Date.now() };
    await persistBuildLog(fly, failed);
    await writeBuild(failed);
    await deleteValidatedUploadBestEffort(options.ns, build.id);
    // The upload is deliberately kept on failure (a retry of the identical spec can reuse
    // it); the bucket lifecycle rule on uploads/ reclaims it.
    return;
  }

  let digest: string | null = null;
  if (options.metadataJson !== null) {
    try {
      const metadata = JSON.parse(options.metadataJson) as Record<string, unknown>;
      const candidate = metadata["containerimage.digest"];
      if (typeof candidate === "string" && /^sha256:[0-9a-f]{64}$/.test(candidate)) digest = candidate;
    } catch {
      // fall through to the registry lookup
    }
  }
  if (digest === null) {
    digest = await fly.resolveImageDigest(appName, build.revision);
  }
  if (digest === null) {
    const failed: StoredBuild = { ...build, status: "failed", error: "build reported success but the built image digest could not be resolved", finished_at_millis: Date.now() };
    await persistBuildLog(fly, failed);
    await writeBuild(failed);
    await deleteValidatedUploadBestEffort(options.ns, build.id);
    return;
  }

  const imageRef = `${config.fly.registryHost}/${appName}@${digest}`;
  const succeeded: StoredBuild = { ...build, status: "succeeded", image: imageRef, finished_at_millis: Date.now() };
  await persistBuildLog(fly, succeeded);
  await writeBuild(succeeded);
  await deleteValidatedUploadBestEffort(options.ns, build.id);

  const storedVersion = await readSpecVersioned(options.ns, options.key);
  // Only roll machines if this build is still the target — a newer PUT supersedes it.
  if (storedVersion !== null && storedVersion.value.revision === build.revision) {
    const stored = storedVersion.value;
    stored.spec = { ...stored.spec, source: { image: imageRef } };
    stored.updated_at_millis = Date.now();
    const resolved = await resolveEnv(fly, options.ns, stored.spec.env);
    if (resolved.ok && await specIsStillOwned(options.ns, options.key, storedVersion.etag)) {
      try {
        await applyMachines(fly, stored, imageRef, resolved.env, lease);
        stored.last_apply_error = null;
      } catch (error) {
        if (error instanceof ReconciliationLeaseLostError) throw error;
        stored.last_apply_error = error instanceof Error ? `deploy failed: ${error.message}` : "deploy failed";
      }
    }
    // Drop the write if a newer apply took ownership while the rollout was in flight.
    await writeSpec(stored, { ifMatch: storedVersion.etag });
  }
  // Success consumed the upload; deleting it here is an optimization — the bucket
  // lifecycle rule on uploads/ owns correctness for every other path.
  if (build.upload_id !== null) {
    try {
      await deleteUpload(options.ns, build.upload_id);
    } catch (error) {
      console.error(`deleting consumed upload ${build.upload_id} failed`, error);
    }
  }
}

function truncateError(text: string | null): string | null {
  if (text === null || text.trim() === "") return null;
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

async function deleteValidatedUploadBestEffort(ns: string, buildId: string): Promise<void> {
  try {
    await deleteValidatedUpload(ns, buildId);
  } catch (error) {
    // The object contains already-validated source and expires with the bucket lifecycle;
    // cleanup must never prevent a terminal build record or its rollout from completing.
    console.error(`deleting validated source for build ${ns}/${buildId} failed`, error);
  }
}

// Durable build log: Marshal (not the harness) drains the builder machine's logs from the
// Fly logs API at terminal state, scrubs every credential it handed to the build, and
// persists JSONL to the bucket — outliving Fly's ~7d retention. The harness stays dumb.
async function persistBuildLog(fly: FlyClient, build: StoredBuild): Promise<void> {
  if (build.builder_app === null || build.builder_machine_id === null) {
    // Mock builds: a canned log so the has_logs contract holds in dev/e2e. The MARSHAL_MOCK_ENV
    // line echoes the resolved plain env values so e2e can verify the backend's stage-2 secret
    // redaction end to end — a real builder never receives tenant env, so this only exists for
    // the mock (which is non-prod-guarded).
    const spec = await readSpec(build.ns, build.key);
    const envEcho = spec === null ? "" : Object.entries(spec.spec.env)
      .flatMap(([envKey, value]) => "value" in value ? [`${envKey}=${value.value}`] : [])
      .join(" ");
    const canned = [
      { at_millis: build.started_at_millis, stream: "stdout" as const, instance: null, text: "MARSHAL_BUILD_START (mock builder)" },
      { at_millis: build.started_at_millis + 1, stream: "stdout" as const, instance: null, text: `MARSHAL_MOCK_ENV ${envEcho}` },
      { at_millis: Date.now(), stream: "stdout" as const, instance: null, text: "MARSHAL_BUILD_DONE (mock builder)" },
    ];
    await writeBuildLog(build.ns, build.key, build.id, canned.map((line) => JSON.stringify(line)).join("\n"));
    return;
  }
  try {
    const lines = await fetchAllLogs(fly, build.builder_app, {
      sinceMillis: build.started_at_millis - 60 * 1000,
      instance: build.builder_machine_id,
    });
    // Skip persisting an empty log object: a transient logs-API failure (rate limit,
    // ingestion lag) must not freeze `has_logs:true, lines:[], complete:true`. Leaving no
    // object makes the logs route fall back to the live proxy instead.
    if (lines.length === 0) return;
    const redactionValues = buildLogRedactionValues(fly, build);
    const jsonl = lines
      .map((line) => ({ ...line, text: redactBuildLogText(line.text, redactionValues) }))
      .map((line) => JSON.stringify(line))
      .join("\n");
    await writeBuildLog(build.ns, build.key, build.id, jsonl);
  } catch (error) {
    // Log persistence is best-effort — the record's terminal status must not be blocked
    // on the logs API. The live proxy already served these lines during the build.
    console.error(`persisting build log for ${build.ns}/${build.key}/${build.id} failed`, error);
  }
}

// Stage-1 redaction values: every credential Marshal handed the build. The org token (with
// and without its "FlyV1 " scheme), the registry basic-auth blob, and the per-build webhook
// token (recomputed, since it's derived, not stored). The presigned tarball URL isn't
// recomputable, so its signature is scrubbed by shape in redactBuildLogText.
export function buildLogRedactionValues(fly: FlyClient, build: StoredBuild): string[] {
  const { fly: flyConfig } = getConfig();
  const values = [flyConfig.token, fly.registryAuthBase64(), computeWebhookToken(build.id, build.ns, build.key)];
  if (flyConfig.token.startsWith("FlyV1 ")) values.push(flyConfig.token.slice("FlyV1 ".length));
  return values;
}

export function redactBuildLogText(text: string, values: string[]): string {
  return redactSecrets(text, values)
    // Presigned URL signatures (the tarball GET) — scrub by shape since the exact URL
    // isn't persisted anywhere Marshal can recompute.
    .replace(/X-Amz-Signature=[A-Za-z0-9%]+/gi, "X-Amz-Signature=<redacted>")
    .replace(/X-Amz-Credential=[A-Za-z0-9%/]+/gi, "X-Amz-Credential=<redacted>");
}

// Lazy backstop for lost webhooks: a build still "running" long after the harness watchdog
// must have fired gets finalized as failed on the next read.
export async function maybeFinalizeStaleBuild(build: StoredBuild): Promise<StoredBuild> {
  if (build.status !== "queued" && build.status !== "running") return build;
  const staleAfterMillis = build.started_at_millis + BUILD_TIMEOUT_SECONDS * 1000 + BUILD_STALE_GRACE_MS;
  if (Date.now() < staleAfterMillis) return build;
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(build.ns));
  if (build.builder_app !== null && build.builder_machine_id !== null) {
    let machine;
    try {
      machine = await fly.getMachine(build.builder_app, build.builder_machine_id);
    } catch (error) {
      // A transient Fly error here must not turn a read (getServiceState/listServiceBuilds/
      // the logs route all call this) into a 502 — leave the build as-is until the next read.
      console.error(`stale-build liveness check for ${build.ns}/${build.key}/${build.id} failed`, error);
      return build;
    }
    if (machine !== null && (machine.state === "started" || machine.state === "starting" || machine.state === "created")) {
      // Builder still alive (clock skew or an unusually slow pull) — leave it alone.
      return build;
    }
  }
  const finalized: StoredBuild = { ...build, status: "failed", error: "the build never reported completion (builder died or the completion webhook was lost)", finished_at_millis: Date.now() };
  await writeBuild(finalized);
  await persistBuildLog(fly, finalized);
  return finalized;
}

// ---------------------------------------------------------------------------
// Reads

export async function getServiceState(ns: string, key: string, preloadedSpec?: StoredSpec | null): Promise<ServiceState> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const stored = preloadedSpec !== undefined ? preloadedSpec : await readSpec(ns, key);
  if (stored === null) throw notFound(`service ${JSON.stringify(key)} not found in namespace ${JSON.stringify(ns)}`);
  const appName = appNameForService(config.envId, ns, key);

  const [machines, certificates, recentBuilds, resolved] = await Promise.all([
    fly.listMachines(appName),
    fly.listCertificates(appName),
    listBuilds(ns, key, { limit: 5 }),
    resolveEnv(fly, ns, stored.spec.env),
  ]);
  const latestForRevision = recentBuilds.find((build) => build.revision === stored.revision) ?? null;
  const checkedBuild = latestForRevision === null ? null : await maybeFinalizeStaleBuild(latestForRevision);

  const domains = await computeDomainStates(fly, appName, certificates);
  const verifiedHostnames = certificates.filter(certificateIsVerified).map((certificate) => certificate.hostname).sort();

  const startedCount = machines.filter((machine) => machine.state === "started").length;
  const machineRevisions = new Set(machines.map((machine) => machine.config.metadata?.hexclave_revision ?? "unknown"));
  const allAtTarget = machines.length > 0 && machineRevisions.size === 1 && machineRevisions.has(stored.revision);
  const runningRevision = machines.length === 0 ? null : machineRevisions.size === 1 ? [...machineRevisions][0] : [...machineRevisions].find((revision) => revision !== stored.revision) ?? stored.revision;

  const status = ((): ServiceState["status"] => {
    if (!resolved.ok) return "blocked";
    if (checkedBuild !== null && (checkedBuild.status === "queued" || checkedBuild.status === "running")) return "building";
    // Checked BEFORE the no-machine branch: an apply that failed before it created anything
    // (ensureApp/ensureFlycastIp/the first createMachine) leaves zero machines and a terminal
    // last_apply_error, and reporting that as "pending" tells callers to keep waiting for a
    // deploy that is already over. `error` below has always surfaced it — only status lied.
    if (stored.last_apply_error !== null) return startedCount > 0 ? "degraded" : "failed";
    if (machines.length === 0) {
      if (checkedBuild !== null && checkedBuild.status === "failed") return "failed";
      return "pending";
    }
    // A failed build for the target revision, with machines still on a stale revision, is a
    // terminal failure — not perpetual "deploying". Nothing is in flight and the failed build
    // is deliberately not retried, so the old machines keep serving in a degraded state.
    if (checkedBuild !== null && checkedBuild.status === "failed" && !allAtTarget) return startedCount > 0 ? "degraded" : "failed";
    if (!allAtTarget || machines.length !== desiredMachineCount(stored.spec)) return "deploying";
    if (startedCount === 0) {
      if (isServerful(stored.spec) || pinnedMachineCount(stored.spec) > 0) return "stopped";
      return "idle";
    }
    if (startedCount < pinnedMachineCount(stored.spec)) return "degraded";
    return "running";
  })();

  const error = ((): string | null => {
    if (!resolved.ok) return `blocked on unresolved refs: ${resolved.blockedRefs.join(", ")}`;
    if (stored.last_apply_error !== null) return stored.last_apply_error;
    if (checkedBuild !== null && checkedBuild.status === "failed") return checkedBuild.error;
    return null;
  })();

  return {
    key,
    type: SERVICE_TYPE_CONTAINER,
    status,
    instances: startedCount,
    revision: runningRevision,
    target_revision: runningRevision === stored.revision && allAtTarget ? null : stored.revision,
    outputs: {
      internal_host: internalHostForService(config.envId, ns, key),
      internal_url: `http://${internalHostForService(config.envId, ns, key)}`,
      url: verifiedHostnames.length > 0 ? `https://${verifiedHostnames[0]}` : null,
    },
    domains,
    error,
    observed_at_millis: Date.now(),
  };
}

export async function computeDomainStates(fly: FlyClient, appName: string, certificates: FlyCertificate[]): Promise<ServiceDomainState[]> {
  if (certificates.length === 0) return [];
  const ips = await fly.getAppIps(appName);
  return certificates
    .slice()
    .sort((a, b) => a.hostname < b.hostname ? -1 : 1)
    .map((certificate) => ({
      hostname: certificate.hostname,
      verified: certificateIsVerified(certificate),
      dns_records: dnsRecordsForCertificate(appName, certificate, ips.sharedIpv4, ips.dedicated.filter((ip) => ip.type === "v6").map((ip) => ip.address)),
      error: null,
    }));
}

export function dnsRecordsForCertificate(appName: string, certificate: FlyCertificate, sharedIpv4: string | null, v6Addresses: string[]): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (certificate.isApex) {
    if (sharedIpv4 !== null) records.push({ type: "A", name: certificate.hostname, value: sharedIpv4 });
    for (const address of v6Addresses) records.push({ type: "AAAA", name: certificate.hostname, value: address });
  } else {
    records.push({ type: "CNAME", name: certificate.hostname, value: `${appName}.fly.dev` });
  }
  if (!certificateIsVerified(certificate)) {
    // Pre-issuance DNS validation: lets the cert issue before (or without) the main
    // record cutting over.
    records.push({ type: "CNAME", name: certificate.dnsValidationHostname, value: certificate.dnsValidationTarget });
  }
  return records;
}

export async function listServices(ns: string): Promise<ServiceState[]> {
  const keys = await listSpecKeys(ns);
  const states = await Promise.all(keys.sort().map(async (key) => {
    try {
      return await getServiceState(ns, key);
    } catch (error) {
      // A service deleted concurrently with this listing (its spec vanished between the key
      // list and the per-key read) must not 404 the whole namespace listing — drop it.
      if (error instanceof MarshalError && error.status === 404) return null;
      throw error;
    }
  }));
  return states.filter((state): state is ServiceState => state !== null);
}

// ---------------------------------------------------------------------------
// DELETE /services/{key}

export async function deleteService(ns: string, key: string): Promise<void> {
  await withReconciliationLease(ns, key, async (lease) => await deleteServiceWithLease(ns, key, lease));
}

async function deleteServiceWithLease(ns: string, key: string, lease: ReconciliationLeaseGuard): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const appName = appNameForService(config.envId, ns, key);

  // Release hostname claims first — certs die with the app, but the bucket registry would
  // otherwise block the hostname forever.
  for (const hostname of await listDomainClaimsForService(ns, key)) {
    const claim = await readDomainClaimVersioned(hostname);
    if (claim !== null && claim.value.ns === ns && claim.value.service_key === key) {
      await releaseDomainClaim(claim);
    }
  }
  // force=true kills machines and releases IPs in one call. Build history is intentionally
  // kept (it's namespaced under builds/<ns>/<key>/).
  //
  // DANGER: this is NO LONGER fully recoverable by re-applying the spec. Destroying the app
  // destroys its VOLUMES with it (smoke-verified against real Fly), so deleting a
  // volume-backed service is irreversible tenant-data loss. Nothing reaches this today — the
  // backend exposes no service-delete route, and MarshalClient.deleteService has no callers —
  // but before any delete path ships, this must either detach and keep the volume (destroy the
  // machines and release the claims without destroying the app) or require an explicit
  // destructive-delete acknowledgement from the caller.
  await lease.assertOwned();
  await fly.deleteApp(appName);
  await deleteSpec(ns, key);
}

// ---------------------------------------------------------------------------
// Builds listing (used by routes; applies the stale-build backstop)

export async function listServiceBuilds(ns: string, key: string, options: { limit: number, beforeMillis?: number }): Promise<StoredBuild[]> {
  const builds = await listBuilds(ns, key, options);
  return await Promise.all(builds.map(async (build) => await maybeFinalizeStaleBuild(build)));
}

export { readBuild, readSpec };
