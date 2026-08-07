import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig, MAX_UPLOAD_BYTES, UPLOAD_EXPIRY_SECONDS } from "./config.js";
import { decryptString, encryptString } from "./spec-crypto.js";
import type { DomainClaim, EnvValue, ReconciliationLease, ServiceSpec, StoredBuild, StoredSpec } from "./types.js";
import { ulidTimeMillis } from "./ulid.js";

// The bucket is Marshal's only state. Layout:
//   specs/<ns>/<key>.json                 — current desired spec + revision; env is AES-GCM encrypted
//   reconciliation-leases/<ns>/<key>.json — renewable per-service Fly mutation lease
//   uploads/<ns>/<id>.tar.gz              — source tarballs (presigned PUT slots; lifecycle-expired)
//   uploads/.validated/<ns>/<build>.tar.gz — immutable validated copies consumed by builders
//   builds/<ns>/<key>/rec/<ulid>.json     — build records (ULID ids → lexicographic ≈ chronological)
//   builds/<ns>/<key>/log/<ulid>.jsonl    — durable build logs (LogLine per line), written at terminal state
//   domains/<hostname>.json               — GLOBAL hostname-uniqueness registry (conditional-PUT claims)
//   domain-index/<ns>/<key>/<hostname>    — per-service index of claims, so deletes can release hostnames

let cachedClient: S3Client | null = null;

function s3(): S3Client {
  if (cachedClient) return cachedClient;
  const { s3: config } = getConfig();
  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return cachedClient;
}

function bucket(): string {
  return getConfig().s3.bucket;
}

function isNoSuchKey(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : null;
  const metadata = "$metadata" in error && typeof error.$metadata === "object" && error.$metadata !== null ? error.$metadata : null;
  const status = metadata !== null && "httpStatusCode" in metadata ? metadata.httpStatusCode : null;
  return name === "PreconditionFailed" || status === 412;
}

// The AWS SDK retries failed requests but NOT responses that die mid-flight (ECONNRESET /
// "aborted" on a reused keep-alive socket — s3mock does this under concurrent load, and
// R2 can too). Every op in this module is idempotent, so one blind retry is safe; the
// conditional-write path is excluded because a 412 must surface, and precondition
// failures are not socket errors anyway.
async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "";
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE" || message === "aborted") {
      return await fn();
    }
    throw error;
  }
}

async function getJson<T>(key: string): Promise<T | null> {
  try {
    return await withTransientRetry(async () => {
      const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      const body = await result.Body?.transformToString();
      if (body === undefined) return null;
      return JSON.parse(body) as T;
    });
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

async function putJson(key: string, value: unknown): Promise<void> {
  await withTransientRetry(async () => await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
  })));
}

export type Versioned<T> = { value: T, etag: string };

async function getJsonVersioned<T>(key: string): Promise<Versioned<T> | null> {
  try {
    return await withTransientRetry(async () => {
      const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      const body = await result.Body?.transformToString();
      if (body === undefined) return null;
      if (result.ETag === undefined) throw new Error(`S3 omitted ETag for ${key}; conditional updates cannot be made safely`);
      return { value: JSON.parse(body) as T, etag: result.ETag };
    });
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

type WriteCondition = { ifMatch: string } | { ifNoneMatch: true };

async function putJsonConditionally(key: string, value: unknown, condition: WriteCondition): Promise<string | null> {
  try {
    const result = await s3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
      ...("ifMatch" in condition ? { IfMatch: condition.ifMatch } : { IfNoneMatch: "*" }),
    }));
    if (result.ETag === undefined) throw new Error(`S3 omitted ETag for conditional write to ${key}`);
    return result.ETag;
  } catch (error) {
    if (isPreconditionFailed(error)) return null;
    throw error;
  }
}

async function deleteObject(key: string): Promise<void> {
  await withTransientRetry(async () => await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })));
}

async function deleteObjectConditionally(key: string, etag: string): Promise<boolean> {
  try {
    await withTransientRetry(async () => await s3().send(new DeleteObjectCommand({
      Bucket: bucket(),
      Key: key,
      IfMatch: etag,
    })));
    return true;
  } catch (error) {
    if (isPreconditionFailed(error)) return false;
    throw error;
  }
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined = undefined;
  do {
    const result: ListObjectsV2CommandOutput = await withTransientRetry(async () => await s3().send(new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })));
    for (const item of result.Contents ?? []) {
      if (item.Key !== undefined) keys.push(item.Key);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
  return keys;
}

// ---------------------------------------------------------------------------
// Specs

type StoredSpecOnDisk = Omit<StoredSpec, "spec"> & {
  spec: Omit<ServiceSpec, "env"> & { encrypted_env: unknown },
};
type PersistedStoredSpec = StoredSpecOnDisk | StoredSpec;

function specKey(ns: string, key: string): string {
  return `specs/${ns}/${key}.json`;
}

function specEncryptionContext(ns: string, key: string, stored: Omit<StoredSpecOnDisk, "spec"> & { spec: Omit<ServiceSpec, "env"> }): string {
  // The requested object path is authoritative: deriving this from the untrusted body would
  // let a bucket writer move a complete object without invalidating its authentication tag.
  // Authenticate the remaining plaintext too, so config/source/revision tampering is detected
  // even though only the secret-bearing environment needs confidentiality.
  return JSON.stringify({ object_key: specKey(ns, key), stored });
}

function storedSpecForDisk(spec: StoredSpec): StoredSpecOnDisk {
  const { env, ...specWithoutEnv } = spec.spec;
  const authenticated = { ...spec, spec: specWithoutEnv };
  return {
    ...authenticated,
    spec: {
      ...specWithoutEnv,
      encrypted_env: encryptString(
        JSON.stringify(env),
        specEncryptionContext(spec.ns, spec.key, authenticated),
        getConfig().dataEncryptionRootKey,
      ),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredEnv(serialized: string): Record<string, EnvValue> {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) throw new Error("decrypted stored service environment is not an object");
  const env = new Map<string, EnvValue>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value)) throw new Error(`decrypted stored environment entry ${JSON.stringify(key)} is not an object`);
    const fields = Object.keys(value);
    if (fields.length === 1 && fields[0] === "value" && typeof value.value === "string") {
      env.set(key, { value: value.value });
    } else if (fields.length === 1 && fields[0] === "ref" && typeof value.ref === "string") {
      env.set(key, { ref: value.ref });
    } else {
      throw new Error(`decrypted stored environment entry ${JSON.stringify(key)} is not { value } or { ref }`);
    }
  }
  return Object.fromEntries(env);
}

function isLegacyStoredSpec(stored: PersistedStoredSpec): stored is StoredSpec {
  return "env" in stored.spec;
}

function storedSpecFromDisk(stored: PersistedStoredSpec, expectedNs: string, expectedKey: string): StoredSpec {
  if (stored.ns !== expectedNs || stored.key !== expectedKey) {
    throw new Error(`stored service identity does not match requested object ${expectedNs}/${expectedKey}`);
  }
  if (isLegacyStoredSpec(stored)) return stored;
  const { encrypted_env: encryptedEnv, ...specWithoutEnv } = stored.spec;
  const authenticated = { ...stored, spec: specWithoutEnv };
  return {
    ...stored,
    spec: {
      ...specWithoutEnv,
      env: parseStoredEnv(decryptString(
        encryptedEnv,
        specEncryptionContext(expectedNs, expectedKey, authenticated),
        getConfig().dataEncryptionRootKey,
      )),
    },
  };
}

export async function readSpec(ns: string, key: string): Promise<StoredSpec | null> {
  return (await readSpecVersioned(ns, key))?.value ?? null;
}

export async function readSpecVersioned(ns: string, key: string): Promise<Versioned<StoredSpec> | null> {
  for (;;) {
    const stored = await getJsonVersioned<PersistedStoredSpec>(specKey(ns, key));
    if (stored === null) return null;
    const value = storedSpecFromDisk(stored.value, ns, key);
    if (!isLegacyStoredSpec(stored.value)) return { value, etag: stored.etag };

    // Draft/QA buckets may contain specs written before application-layer encryption was
    // introduced. Upgrade them atomically on first access so rolling out this fix does not
    // require clearing services, while a concurrent PUT remains the desired-state winner.
    const encryptedEtag = await writeSpec(value, { ifMatch: stored.etag });
    if (encryptedEtag !== null) return { value, etag: encryptedEtag };
  }
}

export async function writeSpec(spec: StoredSpec, condition: WriteCondition): Promise<string | null> {
  return await putJsonConditionally(specKey(spec.ns, spec.key), storedSpecForDisk(spec), condition);
}

export async function deleteSpec(ns: string, key: string): Promise<void> {
  await deleteObject(specKey(ns, key));
}

export async function deleteSpecConditionally(ns: string, key: string, etag: string): Promise<boolean> {
  return await deleteObjectConditionally(specKey(ns, key), etag);
}

export async function listSpecKeys(ns: string): Promise<string[]> {
  const keys = await listKeys(`specs/${ns}/`);
  return keys
    .filter((key) => key.endsWith(".json"))
    .map((key) => key.slice(`specs/${ns}/`.length, -".json".length));
}

// ---------------------------------------------------------------------------
// Per-service reconciliation leases

function reconciliationLeaseKey(ns: string, key: string): string {
  return `reconciliation-leases/${ns}/${key}.json`;
}

export async function readReconciliationLease(ns: string, key: string): Promise<Versioned<ReconciliationLease> | null> {
  return await getJsonVersioned<ReconciliationLease>(reconciliationLeaseKey(ns, key));
}

export async function createReconciliationLease(ns: string, key: string, lease: ReconciliationLease): Promise<string | null> {
  return await putJsonConditionally(reconciliationLeaseKey(ns, key), lease, { ifNoneMatch: true });
}

export async function replaceReconciliationLease(ns: string, key: string, lease: ReconciliationLease, previousEtag: string): Promise<string | null> {
  return await putJsonConditionally(reconciliationLeaseKey(ns, key), lease, { ifMatch: previousEtag });
}

export async function releaseReconciliationLease(ns: string, key: string, etag: string): Promise<boolean> {
  return await deleteObjectConditionally(reconciliationLeaseKey(ns, key), etag);
}

// ---------------------------------------------------------------------------
// Uploads

export async function createUploadSlot(ns: string, id: string): Promise<{ uploadUrl: string, expiresAtMillis: number }> {
  const uploadUrl = await getSignedUrl(s3(), new PutObjectCommand({
    Bucket: bucket(),
    Key: uploadObjectKey(ns, id),
    ContentType: "application/gzip",
  }), { expiresIn: UPLOAD_EXPIRY_SECONDS });
  return { uploadUrl, expiresAtMillis: Date.now() + UPLOAD_EXPIRY_SECONDS * 1000 };
}

export function uploadObjectKey(ns: string, id: string): string {
  return `uploads/${ns}/${id}.tar.gz`;
}

// max_bytes on upload slots is advisory — R2 does not enforce presigned constraints
// (smoke-verified), so the size gate is here, at consume time.
export async function statUpload(ns: string, id: string): Promise<{ sizeBytes: number } | null> {
  try {
    const result = await withTransientRetry(async () => await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: uploadObjectKey(ns, id) })));
    return { sizeBytes: result.ContentLength ?? 0 };
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

export async function readUpload(ns: string, id: string): Promise<Uint8Array | null> {
  try {
    return await withTransientRetry(async () => {
      const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: uploadObjectKey(ns, id) }));
      return await result.Body?.transformToByteArray() ?? null;
    });
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

export async function presignUploadGet(ns: string, id: string, expiresInSeconds: number): Promise<string> {
  return await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: bucket(),
    Key: uploadObjectKey(ns, id),
  }), { expiresIn: expiresInSeconds });
}

function validatedUploadObjectKey(ns: string, buildId: string): string {
  return `uploads/.validated/${ns}/${buildId}.tar.gz`;
}

export async function writeValidatedUpload(ns: string, buildId: string, bytes: Uint8Array): Promise<void> {
  await withTransientRetry(async () => await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: validatedUploadObjectKey(ns, buildId),
    Body: bytes,
    ContentType: "application/gzip",
  })));
}

export async function presignValidatedUploadGet(ns: string, buildId: string, expiresInSeconds: number): Promise<string> {
  return await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: bucket(),
    Key: validatedUploadObjectKey(ns, buildId),
  }), { expiresIn: expiresInSeconds });
}

export async function deleteValidatedUpload(ns: string, buildId: string): Promise<void> {
  await deleteObject(validatedUploadObjectKey(ns, buildId));
}

export async function deleteUpload(ns: string, id: string): Promise<void> {
  await deleteObject(uploadObjectKey(ns, id));
}

export { MAX_UPLOAD_BYTES };

// ---------------------------------------------------------------------------
// Build records + logs

function buildRecordKey(ns: string, key: string, id: string): string {
  return `builds/${ns}/${key}/rec/${id}.json`;
}

function buildLogKey(ns: string, key: string, id: string): string {
  return `builds/${ns}/${key}/log/${id}.jsonl`;
}

export async function readBuild(ns: string, key: string, id: string): Promise<StoredBuild | null> {
  return await getJson<StoredBuild>(buildRecordKey(ns, key, id));
}

export async function readBuildVersioned(ns: string, key: string, id: string): Promise<Versioned<StoredBuild> | null> {
  return await getJsonVersioned<StoredBuild>(buildRecordKey(ns, key, id));
}

export async function writeBuild(build: StoredBuild): Promise<void> {
  await putJson(buildRecordKey(build.ns, build.key, build.id), build);
}

export async function createBuild(build: StoredBuild): Promise<string | null> {
  return await putJsonConditionally(buildRecordKey(build.ns, build.key, build.id), build, { ifNoneMatch: true });
}

export async function replaceBuild(build: StoredBuild, previousEtag: string): Promise<string | null> {
  return await putJsonConditionally(buildRecordKey(build.ns, build.key, build.id), build, { ifMatch: previousEtag });
}

// Newest-first. ULIDs sort ascending by time, so reverse the (paginated, complete) key
// list and filter by the id-embedded timestamp BEFORE fetching record bodies — otherwise a
// service with thousands of builds would GET every record just to return `limit` of them.
export async function listBuilds(ns: string, key: string, options: { limit: number, beforeMillis?: number }): Promise<StoredBuild[]> {
  const prefix = `builds/${ns}/${key}/rec/`;
  const ids = (await listKeys(prefix))
    .map((objectKey) => objectKey.slice(prefix.length, -".json".length))
    .sort()
    .reverse()
    // The ULID's own timestamp bounds the before_millis window without a body read; the
    // record's started_at_millis is re-checked below as the authority. This prefilter is
    // only sound because the id time NEVER runs ahead of started_at_millis — callers must
    // mint build ids with `ulid(startedAtMillis)`, not a bare `ulid()` some awaits later,
    // or a record whose started_at is inside the window gets silently dropped from the page.
    .filter((id) => options.beforeMillis === undefined || ulidTimeMillis(id) < options.beforeMillis);
  const builds: StoredBuild[] = [];
  for (const id of ids) {
    if (builds.length >= options.limit) break;
    const build = await readBuild(ns, key, id);
    if (build === null) continue;
    if (options.beforeMillis !== undefined && build.started_at_millis >= options.beforeMillis) continue;
    builds.push(build);
  }
  return builds;
}

export async function writeBuildLog(ns: string, key: string, id: string, jsonlBody: string): Promise<void> {
  await withTransientRetry(async () => await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: buildLogKey(ns, key, id),
    Body: jsonlBody,
    ContentType: "application/jsonl",
  })));
}

export async function readBuildLog(ns: string, key: string, id: string): Promise<string | null> {
  try {
    return await withTransientRetry(async () => {
      const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: buildLogKey(ns, key, id) }));
      return (await result.Body?.transformToString()) ?? null;
    });
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Domain registry

function domainClaimKey(hostname: string): string {
  return `domains/${hostname}.json`;
}

function domainIndexKey(ns: string, key: string, hostname: string): string {
  return `domain-index/${ns}/${key}/${hostname}`;
}

export async function readDomainClaim(hostname: string): Promise<DomainClaim | null> {
  return (await readDomainClaimVersioned(hostname))?.value ?? null;
}

export async function readDomainClaimVersioned(hostname: string): Promise<Versioned<DomainClaim> | null> {
  return await getJsonVersioned<DomainClaim>(domainClaimKey(hostname));
}

// Atomic claim via conditional write (If-None-Match: "*" → 412 when the hostname is already
// claimed; verified against R2 in the smoke test). Returns false when someone else holds it.
export async function claimDomain(claim: DomainClaim): Promise<boolean> {
  // Write the per-service index entry FIRST: an orphaned index entry (claim never landed) is
  // harmless — deleteService re-validates ownership against the claim before releasing. The
  // reverse order risks the opposite: a crash between the claim PUT and the index PUT would
  // leave a claim that deleteService (which enumerates via the index) can never release,
  // pinning the hostname globally forever.
  await putJson(domainIndexKey(claim.ns, claim.service_key, claim.hostname), {});
  return await putJsonConditionally(domainClaimKey(claim.hostname), claim, { ifNoneMatch: true }) !== null;
}

// Overwrite is only valid for repoints within the same namespace. The ETag fence prevents a
// stale repoint from overwriting a newer owner that landed after the caller's read.
export async function rewriteDomainClaim(previous: Versioned<DomainClaim>, next: DomainClaim): Promise<boolean> {
  await putJson(domainIndexKey(next.ns, next.service_key, next.hostname), {});
  const rewritten = await putJsonConditionally(domainClaimKey(next.hostname), next, { ifMatch: previous.etag });
  if (rewritten === null) return false;
  await deleteObject(domainIndexKey(previous.value.ns, previous.value.service_key, previous.value.hostname));
  return true;
}

// Deleting by ETag is the ownership check and deletion in one S3 operation. A plain
// read-then-delete has a TOCTOU window where a concurrent repoint can replace the object and
// the stale delete then erases the new owner's claim.
export async function releaseDomainClaim(claim: Versioned<DomainClaim>): Promise<boolean> {
  const released = await deleteObjectConditionally(domainClaimKey(claim.value.hostname), claim.etag);
  if (!released) return false;
  await deleteObject(domainIndexKey(claim.value.ns, claim.value.service_key, claim.value.hostname));
  return true;
}

export async function listDomainClaimsForService(ns: string, key: string): Promise<string[]> {
  const prefix = `domain-index/${ns}/${key}/`;
  return (await listKeys(prefix)).map((objectKey) => objectKey.slice(prefix.length));
}
