import { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createHash } from "node:crypto";
import { SmartRequest } from "./smart-request";
import { SmartResponse } from "./smart-response";

// Generic idempotency-key support, keyed by the x-hexclave-idempotency-key
// request header. Introduced for the workflows idempotency floor: the
// in-sandbox runtime keys every first-party action by trigger event + step
// id, so step retries / crash re-executions / version upgrades can never
// double-fire an action. The mechanism is deliberately generic (any
// authenticated non-GET request can use it), but nothing else sends the
// header today.
//
// Semantics:
// - First request with a key executes normally; its response is stored if it
//   is a 2xx/3xx JSON response, and the stored response is replayed for
//   every later request with the same key.
// - Only SUCCESSFUL responses are stored. A thrown error deletes the
//   pending record so a retry re-executes the request — errors are assumed
//   not to have completed their side effect (the common case), and
//   deterministic 4xx errors simply re-derive the same error. This is a
//   deliberate v1 simplification over storing error responses.
// - A concurrent duplicate while the original is still executing gets a 409
//   (the runtime treats that as a retriable step failure; by the next
//   attempt the original has finished and the stored response replays).
// - Reusing a key with a DIFFERENT request is a 400, never a silent replay
//   of the wrong response.
// - Records are pruned after 30 days by the workflow engine's retention
//   sweep, comfortably longer than any retry/upgrade window.

export const IDEMPOTENCY_KEY_HEADER = "x-hexclave-idempotency-key";

// If the original crashed between inserting the pending record and storing
// its response, the record would block the key forever; after this long we
// let a retry take the record over. This guards a single BACKEND REQUEST
// (the hexclaveApp call), not a whole workflow step, so it only needs to
// exceed the longest legitimate route duration (the long-running allowlist
// tops out at ~4min) — and it MUST stay below the earliest possible final
// step retry (~8.4min with min jitter), or that retry would burn its last
// attempt on a 409 from its own crashed predecessor.
const PENDING_TAKEOVER_MS = 5 * 60 * 1000;

function computeRequestHash(fullReq: SmartRequest): string {
  // Covers the acting principal (access type + user) in addition to the
  // request shape: a key must never replay a response to a DIFFERENT caller
  // or to a materially different request.
  const url = new URL(fullReq.url);
  return createHash("sha256")
    .update(fullReq.auth?.type ?? "")
    .update("\0")
    .update(fullReq.auth?.user?.id ?? "")
    .update("\0")
    .update(fullReq.method)
    .update("\0")
    .update(url.pathname)
    .update("\0")
    .update(url.search)
    .update("\0")
    .update(JSON.stringify(fullReq.body ?? null))
    .digest("hex");
}

export async function withRequestIdempotency(fullReq: SmartRequest, execute: () => Promise<SmartResponse>): Promise<SmartResponse> {
  const key = fullReq.headers[IDEMPOTENCY_KEY_HEADER]?.[0];
  if (key == null || key.length === 0 || key.length > 512) return await execute();
  if (["GET", "HEAD", "OPTIONS"].includes(fullReq.method)) return await execute();
  const tenancyId = fullReq.auth?.tenancy.id;
  if (tenancyId == null) return await execute();

  const requestHash = computeRequestHash(fullReq);
  const insertedCount = await globalPrismaClient.idempotencyKeyRecord.createMany({
    data: [{ tenancyId, key, requestHash }],
    skipDuplicates: true,
  });

  if (insertedCount.count === 0) {
    const existing = await globalPrismaClient.idempotencyKeyRecord.findUnique({
      where: { tenancyId_key: { tenancyId, key } },
    });
    if (existing == null) {
      // Deleted between our insert attempt and the read (an error-path
      // cleanup of a concurrent duplicate); just execute.
      return await execute();
    }
    if (existing.requestHash !== requestHash) {
      throw new StatusError(400, "This idempotency key was already used with a different request. Idempotency keys must be unique per logical action.");
    }
    if (existing.responseStatus == null) {
      // Original still executing — unless it died long ago, in which case we
      // take the record over and execute ourselves.
      const takeover = await globalPrismaClient.$queryRaw<{ key: string }[]>(Prisma.sql`
        UPDATE "IdempotencyKeyRecord"
        SET "updatedAt" = NOW()
        WHERE "tenancyId" = ${tenancyId}::uuid AND "key" = ${key}
          AND "responseStatus" IS NULL AND "updatedAt" < NOW() - make_interval(secs => ${PENDING_TAKEOVER_MS / 1000})
        RETURNING "key"
      `);
      if (takeover.length === 0) {
        throw new StatusError(409, "A request with this idempotency key is still being processed. Retry shortly to receive its result.");
      }
    } else {
      // Replay the stored response byte-for-byte (it passes the same
      // response validation as a live one).
      return {
        statusCode: existing.responseStatus,
        bodyType: "json",
        body: existing.responseBody,
      } as SmartResponse;
    }
  }

  let response: SmartResponse;
  try {
    response = await execute();
  } catch (error) {
    // See semantics note above: errors free the key so retries re-execute.
    await globalPrismaClient.idempotencyKeyRecord.deleteMany({ where: { tenancyId, key } });
    throw error;
  }

  if (response.bodyType === "json" && response.statusCode < 400) {
    await globalPrismaClient.idempotencyKeyRecord.update({
      where: { tenancyId_key: { tenancyId, key } },
      data: { responseStatus: response.statusCode, responseBody: response.body as any },
    });
  } else {
    // Non-JSON or error-ish responses aren't replayable; free the key.
    await globalPrismaClient.idempotencyKeyRecord.deleteMany({ where: { tenancyId, key } });
  }
  return response;
}
