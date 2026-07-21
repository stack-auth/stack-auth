import { getPrismaClientForTenancy } from "@/prisma-client";
import { uploadBytes } from "@/s3";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { findRecentSessionReplay, upsertSessionReplaySegmentBounds } from "@/lib/session-replays";
import { insertSessionReplaySpans } from "@/lib/spans";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { getHexclaveServerApp } from "@/hexclave";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCb, gunzipSync } from "node:zlib";

const gzip = promisify(gzipCb);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 1_000_000;
const MAX_EVENTS = 5_000;
// Zip-bomb guard; keep in sync with the client's MAX_SINGLE_EVENT_BYTES.
const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

// Gunzips application/octet-stream bodies (the client gzips large batches);
// plain application/json bodies pass through untouched.
function maybeDecodeBinaryBody(value: unknown): unknown {
  let bytes: Uint8Array | undefined;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  }
  if (!bytes) return value;

  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new StatusError(StatusError.PayloadTooLarge, `Encoded session replay body too large (max ${MAX_BODY_BYTES} bytes)`);
  }
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid encoded session replay body");
  }
  try {
    return JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid encoded session replay body");
  }
}

function extractEventTimesMs(events: unknown[], fallbackMs: number) {
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const e of events) {
    if (typeof e !== "object" || e === null) continue;
    if (!("timestamp" in e)) continue;
    const ts = (e as any).timestamp;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    minTs = Math.min(minTs, ts);
    maxTs = Math.max(maxTs, ts);
  }

  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || minTs > maxTs) {
    return { firstMs: fallbackMs, lastMs: fallbackMs };
  }
  return { firstMs: minTs, lastMs: maxTs };
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload rrweb session replay batch",
    description: "Uploads a batch of rrweb events for a cross-tab session replay.",
    tags: ["Session Replays"],
    hidden: true
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
      refreshTokenId: adaptSchema
    }).defined(),
    body: yupObject({
      browser_session_id: yupString().defined().matches(UUID_RE, "Invalid browser_session_id"),
      session_replay_segment_id: yupString().defined().matches(UUID_RE, "Invalid session_replay_segment_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      started_at_ms: yupNumber().defined().integer().min(0),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(yupMixed().defined()).defined(),
    }).defined().transform((_value, originalValue) => maybeDecodeBinaryBody(originalValue)),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      session_replay_id: yupString().defined(),
      batch_id: yupString().defined(),
      s3_key: yupString().defined(),
      deduped: yupMixed().defined(),
    }).defined(),
  }),
  async handler({ auth, body }, fullReq) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (!auth.refreshTokenId) {
      throw new StatusError(StatusError.BadRequest, "A refresh token is required for session replays");
    }
    const projectUserId = auth.user.id;
    const refreshTokenId = auth.refreshTokenId;

    if (fullReq.bodyBuffer.byteLength > MAX_BODY_BYTES) {
      throw new StatusError(StatusError.PayloadTooLarge, `Request body too large (max ${MAX_BODY_BYTES} bytes)`);
    }

    if (body.events.length === 0) {
      throw new StatusError(StatusError.BadRequest, "events must not be empty");
    }
    if (body.events.length > MAX_EVENTS) {
      throw new StatusError(StatusError.BadRequest, `Too many events (max ${MAX_EVENTS})`);
    }

    const browserSessionId = body.browser_session_id;
    const batchId = body.batch_id;
    const sessionReplaySegmentId = body.session_replay_segment_id;
    const tenancyId = auth.tenancy.id;

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;

    const { firstMs, lastMs } = extractEventTimesMs(body.events, body.sent_at_ms);

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const recentSession = await findRecentSessionReplay(prisma, { tenancyId, refreshTokenId });

    const app = getHexclaveServerApp();

    const isNewSession = recentSession == null;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    if (isNewSession && billingTeamId != null && arePlanLimitsEnforced()) {
      const replaysItem = await app.getItem({ itemId: ITEM_IDS.sessionReplays, teamId: billingTeamId });
      const isDebited = await replaysItem.tryDecreaseQuantity(1);
      if (!isDebited) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.sessionReplays, billingTeamId, 1);
      }
    }

    const replayId = recentSession?.id ?? randomUUID();
    const s3Key = `session-replays/${projectId}/${branchId}/${replayId}/${batchId}.json.gz`;

    // A retry's body is not authoritative: callers may resend the same batch ID
    // with different events. Read the durable chunk before updating projections
    // so an idempotent retry cannot permanently expand the replay's bounds.
    let chunk = await prisma.sessionReplayChunk.findUnique({
      where: { tenancyId_sessionReplayId_batchId: { tenancyId, sessionReplayId: replayId, batchId } },
      select: {
        s3Key: true,
        sessionReplaySegmentId: true,
        firstEventAt: true,
        lastEventAt: true,
      },
    });
    let deduped = chunk != null;
    if (recentSession == null) {
      // The replay row must exist before its first chunk because of the foreign
      // key. Its initial bounds are repaired from the durable chunk below.
      await prisma.sessionReplay.create({
        data: {
          id: replayId,
          tenancyId,
          projectUserId,
          refreshTokenId,
          startedAt: new Date(firstMs),
          lastEventAt: new Date(lastMs),
          shouldUpdateSequenceId: true,
        },
      });
    }

    // A retry must still repair the idempotent segment/span projections. The
    // chunk row is the durable source of truth for those projections; returning
    // early here would strand them if the first request failed after creating
    // the chunk.
    if (chunk == null) {
      const payload = {
        v: 1,
        session_replay_id: replayId,
        browser_session_id: browserSessionId,
        session_replay_segment_id: sessionReplaySegmentId,
        batch_id: batchId,
        started_at_ms: body.started_at_ms,
        sent_at_ms: body.sent_at_ms,
        events: body.events,
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const gzipped = new Uint8Array(await gzip(payloadBytes));

      await uploadBytes({
        key: s3Key,
        body: gzipped,
        contentType: "application/json",
        contentEncoding: "gzip",
        private: true,
      });

      // A single statement both wins the unique-key race or returns the winner.
      // A catch-then-read sequence can briefly miss the concurrent committed row
      // on databases with read routing, turning a harmless duplicate into a 500.
      const chunkRows = await prisma.$queryRaw<Array<{
        s3Key: string,
        sessionReplaySegmentId: string,
        firstEventAt: Date,
        lastEventAt: Date,
        inserted: boolean,
      }>>`
        INSERT INTO "SessionReplayChunk" (
          "id", "tenancyId", "sessionReplayId", "batchId",
          "sessionReplaySegmentId", "browserSessionId", "s3Key",
          "eventCount", "byteLength", "firstEventAt", "lastEventAt"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenancyId}::uuid, ${replayId}::uuid, ${batchId}::uuid,
          ${sessionReplaySegmentId}, ${browserSessionId}, ${s3Key},
          ${body.events.length}, ${gzipped.byteLength}, ${new Date(firstMs)}, ${new Date(lastMs)}
        )
        ON CONFLICT ("tenancyId", "sessionReplayId", "batchId") DO UPDATE
          SET "id" = "SessionReplayChunk"."id"
        RETURNING "s3Key", "sessionReplaySegmentId", "firstEventAt", "lastEventAt", (xmax = 0) AS "inserted"
      `;
      if (chunkRows.length !== 1) {
        throw new HexclaveAssertionError("Session replay chunk upsert did not return exactly one row");
      }
      const insertedChunk = chunkRows[0];
      chunk = insertedChunk;
      deduped = !insertedChunk.inserted;
    }

    // Only durable chunk metadata may advance replay bounds. The atomic update
    // makes concurrent first-seen copies idempotent after their unique-key race
    // and prevents distinct concurrent batches from losing each other's bounds.
    const replayRows = await prisma.$queryRaw<{ startedAt: Date, lastEventAt: Date }[]>`
      UPDATE "SessionReplay"
      SET
        "startedAt" = LEAST("startedAt", ${chunk.firstEventAt}),
        "lastEventAt" = GREATEST("lastEventAt", ${chunk.lastEventAt}),
        "shouldUpdateSequenceId" = TRUE,
        "updatedAt" = NOW()
      WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${replayId}::uuid
      RETURNING "startedAt", "lastEventAt"
    `;
    if (replayRows.length !== 1) {
      throw new HexclaveAssertionError("Session replay bounds update did not return exactly one replay row");
    }
    const replay = replayRows[0];

    // Fold this batch's event-time bounds into the maintained per-segment row
    // (O(1) LEAST/GREATEST upsert — see upsertSessionReplaySegmentBounds). On-path
    // because it's a single cheap Postgres write and the returned bounds are the
    // authoritative segment interval.
    const segmentBounds = await upsertSessionReplaySegmentBounds(prisma, {
      tenancyId,
      sessionReplayId: replayId,
      sessionReplaySegmentId: chunk.sessionReplaySegmentId,
      batchFirstEventAt: chunk.firstEventAt,
      batchLastEventAt: chunk.lastEventAt,
    });

    // Additionally mirror this replay into the spans telemetry surface, written
    // directly to ClickHouse (the same way events are). Purely additive to the
    // Postgres/S3 replay storage above — a $session-replay span for the whole
    // replay and a $session-replay-segment span for this recording segment (per
    // tab), re-written on every non-deduped batch so their end advances. Runs off
    // the response path (waitUntil) so a slow/unavailable ClickHouse — whose client
    // has a 10-minute request timeout — never delays or fails the replay upload.
    runAsynchronouslyAndWaitUntil(async () => {
      try {
        await insertSessionReplaySpans(getClickhouseAdminClient(), {
          projectId,
          branchId,
          replayId,
          sessionReplaySegmentId: chunk.sessionReplaySegmentId,
          projectUserId,
          refreshTokenId,
          replayStartedAt: replay.startedAt,
          replayLastEventAt: replay.lastEventAt,
          segmentStartedAt: segmentBounds.firstEventAt,
          segmentLastEventAt: segmentBounds.lastEventAt,
        });
      } catch (error) {
        captureError("session-replay-spans-insert", error);
      }
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        session_replay_id: replayId,
        batch_id: batchId,
        s3_key: chunk.s3Key,
        deduped,
      },
    };
  },
});
