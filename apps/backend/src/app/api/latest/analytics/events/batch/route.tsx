import { MAX_CUSTOM_EVENT_NAME_LENGTH, isReservedEventName, validateCustomEventPayload } from "@/lib/analytics-custom-events";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { ensureTeamMembershipExists } from "@/lib/request-checks";
import { getHexclaveServerApp } from "@/hexclave";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { createHash } from "node:crypto";
import * as zlib from "node:zlib";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 500;
const MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ANALYTICS_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ANALYTICS_RECEIPT_CLEANUP_BATCH_SIZE = 100;
const ANALYTICS_PROCESSING_LEASE_MS = 2 * 60 * 1000;

// Lone surrogates (\uD800-\uDFFF not part of a valid pair) are technically
// representable in JS strings but rejected by ClickHouse's JSON parser.
// The client-side event tracker can produce these when .substring() truncates
// text in the middle of a surrogate pair (e.g. emoji characters).
// eslint-disable-next-line no-control-regex
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function stripLoneSurrogates(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(LONE_SURROGATE_RE, "\uFFFD");
  }
  if (Array.isArray(value)) {
    return value.map(stripLoneSurrogates);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripLoneSurrogates(v)])
    );
  }
  return value;
}

function attachStableAnalyticsEventId(value: unknown, eventId: string): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...value, event_id: eventId };
  }
  return { event_id: eventId, payload: value };
}

function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalizeForHash(entry)]));
  }
  return value;
}

function analyticsBatchPayloadHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeForHash(body)), "utf8").digest("hex");
}

async function cleanupExpiredAnalyticsBatchReceipts(now: Date): Promise<void> {
  const expiresBefore = new Date(now.getTime() - ANALYTICS_RECEIPT_RETENTION_MS);
  // Delete a small bounded page so normal ingestion gradually maintains the
  // replay ledger without letting one request perform an unbounded table sweep.
  await globalPrismaClient.$executeRaw`
    DELETE FROM "AnalyticsEventBatchReceipt"
    WHERE "id" IN (
      SELECT "id"
      FROM "AnalyticsEventBatchReceipt"
      WHERE "createdAt" < ${expiresBefore}
      ORDER BY "createdAt" ASC
      LIMIT ${ANALYTICS_RECEIPT_CLEANUP_BATCH_SIZE}
    )
  `;
}

// Bodies sent as application/octet-stream are gzipped JSON. The encoding is
// purely to evade keyword-matching adblockers (e.g. filters on "$click").
// We gunzip + JSON.parse here so the rest of the schema can validate the
// decoded object normally.
function maybeDecodeBinaryBody(value: unknown): unknown {
  let bytes: Uint8Array | undefined;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  }
  if (!bytes) return value;

  if (bytes.byteLength > MAX_COMPRESSED_BYTES) {
    throw new StatusError(StatusError.BadRequest, "Encoded analytics body too large");
  }
  let decompressed: Buffer;
  try {
    decompressed = zlib.gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid encoded analytics body");
  }
  try {
    return JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid encoded analytics body");
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload analytics event batch",
    description: "Uploads a batch of analytics events: auto-captured reserved events ($page-view, $click) and customer-defined custom events (bounded names that never start with $, size-limited properties, optional finite numeric value).",
    tags: ["Analytics Events"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
      refreshTokenId: adaptSchema,
    }).defined(),
    body: yupObject({
      session_replay_segment_id: yupString().defined().matches(UUID_RE, "Invalid session_replay_segment_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(
        yupObject({
          // Either one of the accepted reserved types or a customer event name;
          // the handler decides which (yup can't express the union cleanly, and
          // custom names have validation rules beyond a regex — see
          // validateCustomEventPayload).
          event_type: yupString().defined().min(1).max(MAX_CUSTOM_EVENT_NAME_LENGTH),
          event_at_ms: yupNumber().defined().integer().min(0),
          team_id: yupString().uuid().optional(),
          data: yupMixed().defined(),
          // Only allowed on custom events: the per-event numeric observation
          // (e.g. revenue) used by numeric experiment metrics.
          value: yupMixed().optional(),
        }).defined(),
      ).defined().min(1).max(MAX_EVENTS),
    }).defined().transform((_value, originalValue) => maybeDecodeBinaryBody(originalValue)),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      inserted: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (!auth.refreshTokenId) {
      throw new StatusError(StatusError.BadRequest, "A refresh token is required for analytics events");
    }

    const receivedAtMillis = Date.now();
    if (body.sent_at_ms < receivedAtMillis - MAX_EVENT_AGE_MS || body.sent_at_ms > receivedAtMillis + MAX_EVENT_FUTURE_SKEW_MS) {
      throw new StatusError(StatusError.BadRequest, "Analytics sent_at_ms is too far in the past or future");
    }
    for (const event of body.events) {
      if (event.event_at_ms < body.sent_at_ms - MAX_EVENT_AGE_MS || event.event_at_ms > body.sent_at_ms + MAX_EVENT_FUTURE_SKEW_MS) {
        throw new StatusError(StatusError.BadRequest, "Analytics event_at_ms is outside the accepted batch window");
      }
    }

    // Split events into reserved (auto-capture, trusted shape) and custom
    // (customer-defined, strictly validated). Reserved names other than the
    // two auto-capture types are rejected outright — in particular
    // $feature-flag-exposure rows may only enter through the signed
    // feature-flags exposure route, never through this public one.
    const preparedEvents = body.events.map((event) => {
      if (isReservedEventName(event.event_type)) {
        if (event.event_type !== "$page-view" && event.event_type !== "$click") {
          throw new StatusError(StatusError.BadRequest, `Reserved event type ${JSON.stringify(event.event_type)} cannot be uploaded via this endpoint`);
        }
        if (event.value !== undefined) {
          throw new StatusError(StatusError.BadRequest, `Reserved event type ${JSON.stringify(event.event_type)} does not accept a value`);
        }
        return { event_type: event.event_type, event_at_ms: event.event_at_ms, data: event.data, team_id: event.team_id };
      }
      const { properties, value } = validateCustomEventPayload({
        eventName: event.event_type,
        properties: event.data,
        value: event.value,
      });
      // Custom event payloads are wrapped as { properties, value } so customer
      // property keys can never collide with the top-level value field, and
      // numeric-metric queries can always read data.value.
      return { event_type: event.event_type, event_at_ms: event.event_at_ms, data: { properties, value }, team_id: event.team_id };
    });

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;
    const userId = auth.user.id;
    const refreshTokenId = auth.refreshTokenId;
    const tenancyId = auth.tenancy.id;
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const selectedTeamIds = new Set(preparedEvents.flatMap((event) => event.team_id === undefined ? [] : [event.team_id]));
    for (const teamId of selectedTeamIds) {
      await ensureTeamMembershipExists(prisma, { tenancyId, teamId, userId });
    }

    const normalizedBatchId = body.batch_id.toLowerCase();
    const payloadHash = analyticsBatchPayloadHash({ ...body, batch_id: normalizedBatchId });
    await cleanupExpiredAnalyticsBatchReceipts(new Date());
    let receiptId = generateUuid();
    const processingNonce = generateUuid();
    const processingStartedAt = new Date();
    let billingWasCompleted = false;
    const reservation = await globalPrismaClient.analyticsEventBatchReceipt.createMany({
      data: [{
        id: receiptId,
        projectId,
        branchId,
        batchId: normalizedBatchId,
        payloadHash,
        eventCount: body.events.length,
        processingNonce,
        processingStartedAt,
      }],
      skipDuplicates: true,
    });
    if (reservation.count === 0) {
      const existing = await globalPrismaClient.analyticsEventBatchReceipt.findFirst({
        where: { projectId, branchId, batchId: normalizedBatchId },
        select: {
          id: true,
          payloadHash: true,
          completedAt: true,
          insertedCount: true,
          processingStartedAt: true,
          billingCompletedAt: true,
        },
      });
      if (existing == null) {
        throw new StatusError(StatusError.Conflict, "Analytics batch is being retried; retry the request");
      }
      if (existing.payloadHash !== payloadHash) {
        throw new StatusError(StatusError.Conflict, "Analytics batch_id was already used for a different payload");
      }
      if (existing.completedAt == null || existing.insertedCount == null) {
        const leaseExpiresBefore = new Date(processingStartedAt.getTime() - ANALYTICS_PROCESSING_LEASE_MS);
        if (existing.processingStartedAt !== null && existing.processingStartedAt >= leaseExpiresBefore) {
          throw new StatusError(StatusError.Conflict, "Analytics batch is still being processed; retry the request");
        }
        const claimed = await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
          where: {
            id: existing.id,
            completedAt: null,
            OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: leaseExpiresBefore } }],
          },
          data: { processingNonce, processingStartedAt },
        });
        if (claimed.count !== 1) throw new StatusError(StatusError.Conflict, "Analytics batch is still being processed; retry the request");
        receiptId = existing.id;
        billingWasCompleted = existing.billingCompletedAt !== null;
      } else {
        return {
          statusCode: 200,
          bodyType: "json",
          body: { inserted: existing.insertedCount },
        };
      }
    }

    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    const getBilledItem = async () => billingTeamId != null && arePlanLimitsEnforced()
      ? await getHexclaveServerApp().getItem({ itemId: ITEM_IDS.analyticsEvents, teamId: billingTeamId })
      : null;
    let billedItem: Awaited<ReturnType<typeof getBilledItem>> = null;
    const billingNonce = generateUuid();
    const billingIdempotencyKey = createHash("sha256").update(
      ["analytics-events", projectId, branchId, normalizedBatchId, payloadHash].join("\0"),
      "utf8",
    ).digest("hex");
    try {
      billedItem = await getBilledItem();
      const recentSession = await findRecentSessionReplay(prisma, { tenancyId, refreshTokenId });
      if (billedItem != null && !billingWasCompleted) {
        const billingReservation = await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
          where: { id: receiptId, completedAt: null, billingCompletedAt: null },
          data: { billingNonce, billingStartedAt: new Date() },
        });
        if (billingReservation.count === 1) {
          const isDebited = await billedItem.tryDecreaseQuantity(body.events.length, { idempotencyKey: billingIdempotencyKey });
          if (!isDebited) {
            await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
              where: { id: receiptId, billingNonce, completedAt: null },
              data: { billingNonce: null, billingStartedAt: null, billingCompletedAt: null },
            });
            if (billingTeamId == null) {
              throw new HexclaveAssertionError("An analytics billing item cannot exist without a billing team");
            }
            throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsEvents, billingTeamId, body.events.length);
          }
          await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
            where: { id: receiptId, billingNonce, completedAt: null },
            data: { billingCompletedAt: new Date() },
          });
        }
      }

      const rows = preparedEvents.map((event, index) => ({
        event_type: event.event_type,
        event_at: new Date(event.event_at_ms),
        data: attachStableAnalyticsEventId(stripLoneSurrogates(event.data), `${normalizedBatchId}:${index}`),
        project_id: projectId,
        branch_id: branchId,
        user_id: userId,
        team_id: event.team_id ?? null,
        refresh_token_id: refreshTokenId,
        session_replay_id: recentSession?.id ?? null,
        session_replay_segment_id: body.session_replay_segment_id,
      }));

      await getClickhouseAdminClient().insert({
        table: "analytics_internal.events",
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: {
          date_time_input_format: "best_effort",
          async_insert: 1,
        },
      });
    } catch (error) {
      // Billing uses a stable idempotency key and remains attached to this
      // durable receipt. A retry resumes ClickHouse delivery without charging
      // again; retaining the debit avoids an ambiguous refund if ClickHouse
      // accepted a prior attempt before the worker stopped.
      await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
        where: { id: receiptId, processingNonce, completedAt: null },
        data: { processingNonce: null, processingStartedAt: null },
      });
      throw error;
    }

    const completed = await globalPrismaClient.analyticsEventBatchReceipt.updateMany({
      where: { id: receiptId, processingNonce, completedAt: null },
      data: { insertedCount: body.events.length, completedAt: new Date(), processingNonce: null, processingStartedAt: null },
    });
    if (completed.count !== 1) {
      throw new HexclaveAssertionError(`Analytics batch receipt ${receiptId} disappeared before delivery could be marked complete`);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: body.events.length },
    };
  },
});
