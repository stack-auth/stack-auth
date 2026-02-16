import { getPrismaClientForTenancy } from "@/prisma-client";
import { uploadBytes } from "@/s3";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@/generated/prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";

const gzip = promisify(gzipCb);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 5_000_000;
const MAX_EVENTS = 5_000;
const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

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
    summary: "Upload rrweb session recording batch",
    description: "Uploads a batch of rrweb events for a cross-tab session recording.",
    tags: ["Session Recordings"],
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
      tab_id: yupString().defined().matches(UUID_RE, "Invalid tab_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      started_at_ms: yupNumber().defined().integer().min(0),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      session_recording_id: yupString().defined(),
      batch_id: yupString().defined(),
      s3_key: yupString().defined(),
      deduped: yupMixed().defined(),
    }).defined(),
  }),
  async handler({ auth, body }, fullReq) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          session_recording_id: "",
          batch_id: body.batch_id,
          s3_key: "",
          deduped: false,
        },
      };
    }
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (!auth.refreshTokenId) {
      throw new StatusError(StatusError.BadRequest, "A refresh token is required for session recordings");
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
    const tabId = body.tab_id;
    const tenancyId = auth.tenancy.id;

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;

    const { firstMs, lastMs } = extractEventTimesMs(body.events, body.sent_at_ms);

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Find a recent session recording for this refresh token (temporal grouping).
    // If the last batch arrived within SESSION_IDLE_TIMEOUT_MS, reuse that recording.
    // Also enforce a max session duration so recordings don't grow indefinitely.
    const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS);
    const maxDurationCutoff = new Date(Date.now() - MAX_SESSION_DURATION_MS);
    const recentSession = await prisma.sessionRecording.findFirst({
      where: {
        tenancyId,
        refreshTokenId,
        updatedAt: { gte: cutoff },
        startedAt: { gte: maxDurationCutoff },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, startedAt: true, lastEventAt: true },
    });

    const recordingId = recentSession?.id ?? randomUUID();
    const s3Key = `session-recordings/${projectId}/${branchId}/${recordingId}/${batchId}.json.gz`;

    const newStartedAtMs = Math.min(recentSession?.startedAt.getTime() ?? Number.POSITIVE_INFINITY, firstMs);
    const newLastEventAtMs = Math.max(recentSession?.lastEventAt.getTime() ?? 0, lastMs);
    await prisma.sessionRecording.upsert({
      where: { tenancyId_id: { tenancyId, id: recordingId } },
      create: {
        id: recordingId,
        tenancyId,
        projectUserId,
        refreshTokenId,
        startedAt: new Date(firstMs),
        lastEventAt: new Date(newLastEventAtMs),
      },
      update: {
        startedAt: new Date(newStartedAtMs),
        lastEventAt: new Date(newLastEventAtMs),
      },
    });

    // If we already have this batch for this session, return deduped without touching S3.
    const existingChunk = await prisma.sessionRecordingChunk.findUnique({
      where: { tenancyId_sessionRecordingId_batchId: { tenancyId, sessionRecordingId: recordingId, batchId } },
      select: { s3Key: true },
    });
    if (existingChunk) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          session_recording_id: recordingId,
          batch_id: batchId,
          s3_key: existingChunk.s3Key,
          deduped: true,
        },
      };
    }

    const payload = {
      v: 1,
      session_recording_id: recordingId,
      browser_session_id: browserSessionId,
      tab_id: tabId,
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

    try {
      await prisma.sessionRecordingChunk.create({
        data: {
          tenancyId,
          sessionRecordingId: recordingId,
          batchId,
          tabId,
          browserSessionId,
          s3Key,
          eventCount: body.events.length,
          byteLength: gzipped.byteLength,
          firstEventAt: new Date(firstMs),
          lastEventAt: new Date(lastMs),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return {
          statusCode: 200,
          bodyType: "json",
          body: {
            session_recording_id: recordingId,
            batch_id: batchId,
            s3_key: s3Key,
            deduped: true,
          },
        };
      }
      throw e;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        session_recording_id: recordingId,
        batch_id: batchId,
        s3_key: s3Key,
        deduped: false,
      },
    };
  },
});
