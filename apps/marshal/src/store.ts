import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig, MAX_UPLOAD_BYTES, UPLOAD_EXPIRY_SECONDS } from "./config.js";
import type { DomainClaim, StoredBuild, StoredSpec } from "./types.js";
import { ulidTimeMillis } from "./ulid.js";

// The bucket is Marshal's only state. Layout:
//   specs/<ns>/<key>.json                 — current desired spec + revision (written on every PUT)
//   uploads/<ns>/<id>.tar.gz              — source tarballs (presigned PUT slots; lifecycle-expired)
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

// KNOWN LIMITATION — spec/build writes are last-writer-wins (no compare-and-swap).
// `writeSpec`/`writeBuild` go through this plain PutObject, so a read-modify-write whose
// window spans a machine rollout (minutes) can be clobbered by a concurrent apply/webhook:
//   - a completeBuild finishing its rollout can overwrite a newer PUT's spec, stranding the
//     newer revision (its later build then sees revision-mismatch and refuses to roll);
//   - two concurrent same-revision PUTs can each spawn a builder;
//   - a delete racing an in-flight apply can be resurrected by the apply's ensureApp/writeSpec.
// The `buildForRevision` adoption in applyServiceSpec and the idempotency guards in
// completeBuild soften the blast radius, and in practice the backend serializes deploys per
// service (the CLI applies one revision at a time and waits), so concurrent same-service
// applies are unlikely. The real fix is optimistic concurrency: carry the GetObject ETag
// through readSpec and do an If-Match conditional PutObject in writeSpec/writeBuild, retrying
// (or dropping the write when a newer revision owns the spec) on 412. Tracked for a follow-up.
async function putJson(key: string, value: unknown): Promise<void> {
  await withTransientRetry(async () => await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
  })));
}

async function deleteObject(key: string): Promise<void> {
  await withTransientRetry(async () => await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })));
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

function specKey(ns: string, key: string): string {
  return `specs/${ns}/${key}.json`;
}

export async function readSpec(ns: string, key: string): Promise<StoredSpec | null> {
  return await getJson<StoredSpec>(specKey(ns, key));
}

export async function writeSpec(spec: StoredSpec): Promise<void> {
  await putJson(specKey(spec.ns, spec.key), spec);
}

export async function deleteSpec(ns: string, key: string): Promise<void> {
  await deleteObject(specKey(ns, key));
}

export async function listSpecKeys(ns: string): Promise<string[]> {
  const keys = await listKeys(`specs/${ns}/`);
  return keys
    .filter((key) => key.endsWith(".json"))
    .map((key) => key.slice(`specs/${ns}/`.length, -".json".length));
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

export async function presignUploadGet(ns: string, id: string, expiresInSeconds: number): Promise<string> {
  return await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: bucket(),
    Key: uploadObjectKey(ns, id),
  }), { expiresIn: expiresInSeconds });
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

export async function writeBuild(build: StoredBuild): Promise<void> {
  await putJson(buildRecordKey(build.ns, build.key, build.id), build);
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
  return await getJson<DomainClaim>(domainClaimKey(hostname));
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
  try {
    await s3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: domainClaimKey(claim.hostname),
      Body: JSON.stringify(claim),
      ContentType: "application/json",
      IfNoneMatch: "*",
    }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 412 || (error as { name?: string }).name === "PreconditionFailed") return false;
    throw error;
  }
  return true;
}

// Overwrite is only valid for repoints within the same namespace — callers must have read
// the existing claim first and verified ownership.
export async function rewriteDomainClaim(previous: DomainClaim, next: DomainClaim): Promise<void> {
  await putJson(domainClaimKey(next.hostname), next);
  await deleteObject(domainIndexKey(previous.ns, previous.service_key, previous.hostname));
  await putJson(domainIndexKey(next.ns, next.service_key, next.hostname), {});
}

export async function releaseDomainClaim(claim: DomainClaim): Promise<void> {
  await deleteObject(domainClaimKey(claim.hostname));
  await deleteObject(domainIndexKey(claim.ns, claim.service_key, claim.hostname));
}

export async function listDomainClaimsForService(ns: string, key: string): Promise<string[]> {
  const prefix = `domain-index/${ns}/${key}/`;
  return (await listKeys(prefix)).map((objectKey) => objectKey.slice(prefix.length));
}
