import { getClickhouseAdminClient, stripLoneSurrogates } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { buildBatchSpanRows, buildEventSpanFields, insertSpans, toSpanId, SPAN_ID_PREFIXES } from "@/lib/spans";
import { getHexclaveServerApp } from "@/hexclave";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { CLIENT_SYSTEM_SPAN_TYPES, CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, CUSTOM_TELEMETRY_NAME_RE, PAGE_VIEW_SPAN_TYPE, SYSTEM_EVENT_TYPES } from "@hexclave/shared/dist/utils/telemetry";
import { Buffer } from "node:buffer";
import * as zlib from "node:zlib";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 500;
const MAX_SPANS = 500;
const MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

function isPlainObjectWithinLimit(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  let serialized: string | undefined;
  try {
    const stringified = JSON.stringify(value);
    serialized = typeof stringified === "string" ? stringified : undefined;
  } catch {
    return false;
  }
  return serialized !== undefined && Buffer.byteLength(serialized, "utf8") <= CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES;
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
    summary: "Upload analytics telemetry batch",
    description: "Uploads a batch of analytics telemetry: auto-captured system events and spans ($page-view, $click, …), custom events, and custom spans.",
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
      // Required for client auth (see the request-level auth-type tests below —
      // browser batches are always tied to a per-tab segment); optional for
      // server/admin auth.
      session_replay_segment_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_segment_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      // Server/admin auth only (see the request-level auth-type tests below):
      // attributes the batch to a user when there is no session access token to
      // derive one from.
      user_id: yupString().optional().matches(UUID_RE, "Invalid user_id"),
      // Server/admin auth only: the caller's resolved request context, forwarded
      // by the server SDK's withSpan({ request }) so a backend span parents under
      // the client session ($refresh-token/$session-replay/$session-replay-segment).
      // Trusted here because server auth is the customer's secret key; rejected
      // under client auth, where the same values come from the session itself.
      refresh_token_id: yupString().optional().matches(UUID_RE, "Invalid refresh_token_id"),
      session_replay_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_id"),
      events: yupArray(
        yupObject({
          event_type: yupString().defined().test(
            "event-type",
            `event_type must be one of ${SYSTEM_EVENT_TYPES.join(", ")} or a custom name matching ${CUSTOM_TELEMETRY_NAME_RE}`,
            // yup skips tests for undefined values, so `value` is always set here.
            (value) => (SYSTEM_EVENT_TYPES as readonly string[]).includes(value) || CUSTOM_TELEMETRY_NAME_RE.test(value),
          ),
          event_at_ms: yupNumber().defined().integer().min(0),
          data: yupMixed().defined(),
          // Custom ancestor chain, root-first, raw span uuids. System ancestry
          // (refresh-token/replay/segment/page-view) is composed server-side on top.
          parent_span_ids: yupArray(yupString().defined().matches(UUID_RE, "Invalid parent span id")).optional().max(CUSTOM_TELEMETRY_MAX_PARENT_CHAIN),
          // The `$page-view` span this event happened on — client tab state the
          // server cannot derive, so it rides per-item (a batch can straddle a
          // navigation). Untrusted label, same trust model as the segment id.
          page_view_span_id: yupString().optional().matches(UUID_RE, "Invalid page_view_span_id"),
        }).defined().test(
          "custom-event-data",
          `Event data must be a JSON object of at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} serialized bytes`,
          (event) => isPlainObjectWithinLimit(event.data),
        ),
      ).optional().max(MAX_EVENTS),
      spans: yupArray(
        yupObject({
          span_id: yupString().defined().matches(UUID_RE, "Invalid span_id"),
          // Custom names, or the client-writable system autocapture types
          // ($page-view, $away, …). All other `$…` span types are
          // server-derived and can never be written through this endpoint.
          span_type: yupString().defined().test(
            "span-type",
            `span_type must be one of ${CLIENT_SYSTEM_SPAN_TYPES.join(", ")} or a custom name matching ${CUSTOM_TELEMETRY_NAME_RE}`,
            // yup skips tests for undefined values, so `value` is always set here.
            (value) => (CLIENT_SYSTEM_SPAN_TYPES as readonly string[]).includes(value) || CUSTOM_TELEMETRY_NAME_RE.test(value),
          ),
          started_at_ms: yupNumber().defined().integer().min(0),
          ended_at_ms: yupNumber().nullable().defined().integer().min(0),
          parent_span_ids: yupArray(yupString().defined().matches(UUID_RE, "Invalid parent span id")).defined().max(CUSTOM_TELEMETRY_MAX_PARENT_CHAIN),
          data: yupMixed().defined().test(
            "span-data",
            `Span data must be a JSON object of at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} serialized bytes`,
            (value) => isPlainObjectWithinLimit(value),
          ),
          updated_at_ms: yupNumber().defined().integer().min(0),
          // See the event-level page_view_span_id above.
          page_view_span_id: yupString().optional().matches(UUID_RE, "Invalid page_view_span_id"),
        }).defined().test(
          "span-interval",
          "ended_at_ms must be greater than or equal to started_at_ms",
          (span) => span.ended_at_ms == null || span.ended_at_ms >= span.started_at_ms,
        ).test(
          "page-view-span-parent",
          "A $page-view span must not carry page_view_span_id or parent_span_ids, and a span must not name itself as its page_view_span_id",
          (span) => (
            span.span_type !== PAGE_VIEW_SPAN_TYPE || (span.page_view_span_id == null && span.parent_span_ids.length === 0)
          ) && (span.page_view_span_id == null || span.page_view_span_id !== span.span_id),
        ),
      ).optional().max(MAX_SPANS),
    }).defined().test(
      "non-empty-batch",
      "A batch must contain at least one event or span",
      (body) => (body.events?.length ?? 0) + (body.spans?.length ?? 0) >= 1,
    ).transform((_value, originalValue) => maybeDecodeBinaryBody(originalValue)),
  }).test(
    // Auth-type-dependent body rules live here in the schema (not the handler) so
    // the request contract is fully declared in one place. They must be
    // request-level tests because they need auth.type, which field-level schemas
    // inside `body` can't see.
    "client-auth-derives-identity",
    "user_id / refresh_token_id / session_replay_id must not be set with client auth; they are derived from the session",
    (req) => req.auth.type !== "client" || (req.body.user_id == null && req.body.refresh_token_id == null && req.body.session_replay_id == null),
  ).test(
    "client-auth-requires-segment",
    "session_replay_segment_id is required for analytics batches with client auth",
    (req) => req.auth.type !== "client" || req.body.session_replay_segment_id != null,
  ),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      // `inserted` = events durably written to ClickHouse on the response path.
      // `accepted_spans` = spans accepted for async processing — not yet
      // confirmed written. A background insert failure refunds the spans debit
      // (see the waitUntil catch below); the client cannot observe that outcome
      // from this response.
      inserted: yupNumber().defined(),
      accepted_spans: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }

    const events = body.events ?? [];
    const spans = body.spans ?? [];
    const tenancyId = auth.tenancy.id;
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Client auth is the browser tracker: identity comes from the session (user +
    // refresh token, always present) and batches are tied to a per-tab segment.
    // Server/admin auth has no session to derive from, so the caller attributes
    // the batch explicitly via body.user_id (or not at all — project-level rows).
    let userId: string | null;
    let refreshTokenId: string | null;
    // The auth-type-dependent BODY rules (user_id forbidden, segment required for
    // client auth) are enforced declaratively in the request schema above; only
    // checks that need runtime state (session presence, DB lookups) live here.
    if (auth.type === "client") {
      if (!auth.user) {
        throw new KnownErrors.UserAuthenticationRequired();
      }
      if (!auth.refreshTokenId) {
        throw new StatusError(StatusError.BadRequest, "A refresh token is required for analytics events");
      }
      userId = auth.user.id;
      refreshTokenId = auth.refreshTokenId;
    } else {
      if (body.user_id != null) {
        const user = await prisma.projectUser.findUnique({
          where: {
            tenancyId_projectUserId: {
              tenancyId,
              projectUserId: body.user_id,
            },
          },
        });
        if (!user) {
          throw new StatusError(StatusError.BadRequest, "user_id does not correspond to a user on this project/branch");
        }
      }
      userId = body.user_id ?? auth.user?.id ?? null;
      // The server SDK forwards the caller's refresh token (resolved from the
      // request session) so the backend can compose the $refresh-token/$session-replay
      // ancestry; fall back to the request's own auth for admin/session sends.
      refreshTokenId = body.refresh_token_id ?? auth.refreshTokenId ?? null;
    }

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;

    // Validate explicitly forwarded replay context before touching quota. If no
    // replay was forwarded, derive the caller's current rolling replay from the
    // refresh token instead.
    let sessionReplayId = body.session_replay_id ?? null;
    if (sessionReplayId != null) {
      if (refreshTokenId == null) {
        throw new StatusError(StatusError.BadRequest, "session_replay_id requires refresh_token_id");
      }
      const replay = await prisma.sessionReplay.findFirst({
        where: {
          tenancyId,
          id: sessionReplayId,
          refreshTokenId,
          ...userId != null ? { projectUserId: userId } : {},
        },
        select: { id: true },
      });
      if (replay == null) {
        throw new StatusError(StatusError.BadRequest, "session_replay_id does not correspond to the forwarded refresh token and user");
      }
    }
    if (sessionReplayId == null && refreshTokenId != null) {
      const recentSession = await findRecentSessionReplay(prisma, {
        tenancyId,
        refreshTokenId,
        ...userId != null ? { projectUserId: userId } : {},
      });
      sessionReplayId = recentSession?.id ?? null;
    }
    const sessionReplaySegmentId = body.session_replay_segment_id ?? null;

    const app = getHexclaveServerApp();
    const refundItem = async (
      itemId: typeof ITEM_IDS.analyticsEvents | typeof ITEM_IDS.analyticsSpans,
      quantity: number,
      captureKey: string,
    ) => {
      if (billingTeamId == null || quantity === 0) return;
      try {
        const item = await app.getItem({ itemId, teamId: billingTeamId });
        await item.increaseQuantity(quantity);
      } catch (error) {
        // Preserve the operation's original failure while surfacing a failed
        // compensation separately for operators to repair.
        captureError(captureKey, error);
      }
    };

    // Events and spans are metered as SEPARATE items so spans can be priced and
    // limited independently of events later. The whole batch is atomic
    // billing-wise: if the second debit fails, the first is refunded and the
    // request is rejected, so a partial batch never burns quota.
    //
    // Only CUSTOM spans are billable. System autocapture spans ($page-view,
    // $away, …) are free — the interaction is already metered via its
    // event counterpart, and the span_writes usage-measurement MV excludes
    // `$`-prefixed types, so debiting them here would silently drift quota
    // away from the usage the customer sees.
    //
    // Spans are charged at accept time (before the off-path ClickHouse insert).
    // If that insert later fails, the background task refunds the debit — see
    // `spansBillingTeamIdForRefund` below. Captured here so the async path
    // knows whether a debit actually happened (plan limits may be off).
    const billableSpanCount = spans.filter((span) => !span.span_type.startsWith("$")).length;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    let eventsBillingTeamIdForRefund: string | null = null;
    let spansBillingTeamIdForRefund: string | null = null;
    if (billingTeamId != null && arePlanLimitsEnforced()) {
      if (events.length > 0) {
        const eventsItem = await app.getItem({ itemId: ITEM_IDS.analyticsEvents, teamId: billingTeamId });
        const isDebited = await eventsItem.tryDecreaseQuantity(events.length);
        if (!isDebited) {
          throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsEvents, billingTeamId, events.length);
        }
        eventsBillingTeamIdForRefund = billingTeamId;
      }
      if (billableSpanCount > 0) {
        const spansItem = await app.getItem({ itemId: ITEM_IDS.analyticsSpans, teamId: billingTeamId });
        const isDebited = await spansItem.tryDecreaseQuantity(billableSpanCount);
        if (!isDebited) {
          if (events.length > 0) {
            await refundItem(ITEM_IDS.analyticsEvents, events.length, "analytics-events-span-debit-refund");
            eventsBillingTeamIdForRefund = null;
          }
          throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsSpans, billingTeamId, billableSpanCount);
        }
        spansBillingTeamIdForRefund = billingTeamId;
      }
    }

    const clickhouseClient = await (async () => {
      try {
        const clickhouseClient = getClickhouseAdminClient();

        // Point each event at its ancestor spans (root-first: refresh-token,
        // replay, then the per-tab span when a replay exists, then the item's
        // $page-view span when the client named one). The per-tab id itself
        // already lives in session_replay_segment_id. Custom ancestors are
        // appended after the system ancestry with the cs- prefix.
        const eventSpanFields = buildEventSpanFields({
          sessionReplayId,
          sessionReplaySegmentId,
          refreshTokenId,
        });

        const rows = events.map((event) => {
          const parentSpanIds = [
            ...eventSpanFields.parent_span_ids,
            ...event.page_view_span_id != null ? [toSpanId(SPAN_ID_PREFIXES.pageView, event.page_view_span_id)] : [],
            ...(event.parent_span_ids ?? []).map((id) => toSpanId(SPAN_ID_PREFIXES.custom, id)),
          ];
          return {
            event_type: event.event_type,
            event_at: new Date(event.event_at_ms),
            data: stripLoneSurrogates(event.data),
            project_id: projectId,
            branch_id: branchId,
            user_id: userId,
            team_id: null,
            refresh_token_id: refreshTokenId,
            session_replay_id: sessionReplayId,
            session_replay_segment_id: sessionReplaySegmentId,
            parent_span_ids: parentSpanIds,
            trace_id: parentSpanIds[0] ?? null,
          };
        });

        if (rows.length > 0) {
          await clickhouseClient.insert({
            table: "analytics_internal.events",
            values: rows,
            format: "JSONEachRow",
            clickhouse_settings: {
              date_time_input_format: "best_effort",
              async_insert: 1,
              wait_for_async_insert: 1,
            },
          });
        }
        return clickhouseClient;
      } catch (error) {
        await Promise.all([
          eventsBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsEvents, events.length, "analytics-events-on-path-refund"),
          spansBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsSpans, billableSpanCount, "analytics-spans-on-path-refund"),
        ]);
        throw error;
      }
    })();

    // Do not acknowledge spans until ClickHouse has accepted the insert. An
    // in-memory background handoff is not durable: the process can exit after
    // returning 200 and before the write starts. The ClickHouse insert uses
    // wait_for_async_insert, so completing this await is the durability boundary
    // represented by accepted_spans in the response.
    if (spans.length > 0) {
      try {
        const spanRows = buildBatchSpanRows({
          spans,
          projectId,
          branchId,
          userId,
          refreshTokenId,
          sessionReplayId,
          sessionReplaySegmentId,
          serverNowMs: Date.now(),
        });
        await insertSpans(clickhouseClient, spanRows);
      } catch (error) {
        if (spansBillingTeamIdForRefund != null) {
          await refundItem(ITEM_IDS.analyticsSpans, billableSpanCount, "analytics-custom-spans-refund");
        }
        throw error;
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: events.length, accepted_spans: spans.length },
    };
  },
});
