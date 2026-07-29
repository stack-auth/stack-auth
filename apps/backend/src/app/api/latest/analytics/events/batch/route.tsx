import { getBatchDestinationDeduplicationToken, insertBatchEvents } from "@/lib/analytics-telemetry-writers";
import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { increasePlanItemQuantity, tryDecreasePlanItemQuantities, type MeteredPlanItemId } from "@/lib/plan-metering";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { buildBatchSpanRows, getBatchParentPathError, insertSpans } from "@/lib/spans";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { CLIENT_SYSTEM_SPAN_TYPES, CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, CUSTOM_TELEMETRY_NAME_RE, HTTP_CLIENT_SPAN_TYPE, LOG_LEVELS, PAGE_VIEW_SPAN_TYPE, SERVER_SYSTEM_SPAN_TYPES, SYSTEM_EVENT_TYPES, TELEMETRY_MAX_LOG_MESSAGE_BYTES, TELEMETRY_UUID_RE, canWriteTelemetrySignal, classifyTelemetrySignal, getTelemetryResourceError, isTelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { Buffer } from "node:buffer";
import * as zlib from "node:zlib";

// Hoisted to shared so the SDK, the propagation-header codec, and this route
// validate identically — local drift 400s whole batches.
const UUID_RE = TELEMETRY_UUID_RE;

const LOG_EVENT_TYPE = "$log";

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
      // Versions the BATCH body the way the propagation header's `v1.` prefix
      // versions the header — so the wire contract can evolve without guessing
      // from field shapes. This ingestion surface is unreleased, so v2 replaces
      // the earlier pre-release shape directly.
      schema_version: yupNumber().defined().integer().oneOf([2]),
      resource: yupMixed().defined().test(
        "telemetry-resource",
        "Invalid telemetry resource",
        (value) => getTelemetryResourceError(value) === null,
      ),
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
          // The `$http-client` span this event happened under. Only meaningful
          // when the fetch is the item's NEAREST known ancestor (server SDK
          // items whose custom chain came entirely from the propagation
          // header) — see buildBatchSpanRows for the composition rule.
          http_client_span_id: yupString().optional().matches(UUID_RE, "Invalid http_client_span_id"),
          // `$log` items only: the human-readable message + log level.
          // Structured attributes ride in `data` like any other event.
          message: yupString().optional().test(
            "log-message-size",
            `message must be at most ${TELEMETRY_MAX_LOG_MESSAGE_BYTES} bytes`,
            (value) => value === undefined || Buffer.byteLength(value, "utf8") <= TELEMETRY_MAX_LOG_MESSAGE_BYTES,
          ),
          level: yupString().optional().oneOf(LOG_LEVELS),
        }).defined().test(
          "custom-event-data",
          `Event data must be a JSON object of at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} serialized bytes`,
          (event) => isPlainObjectWithinLimit(event.data),
        ).test(
          "log-fields",
          `message/level are required for ${LOG_EVENT_TYPE} events and forbidden for any other event type`,
          (event) => event.event_type === LOG_EVENT_TYPE
            ? event.message !== undefined && event.level !== undefined
            : event.message === undefined && event.level === undefined,
        ),
      ).optional().max(MAX_EVENTS),
      spans: yupArray(
        yupObject({
          span_id: yupString().defined().matches(UUID_RE, "Invalid span_id"),
          // Custom names, the client-writable system autocapture types
          // ($page-view, $away, …), or the server-SDK-minted system types
          // ($lib-span — gated to server/admin auth by the request-level test
          // below, since field-level schemas can't see auth.type). All other
          // `$…` span types are backend-derived and can never be written
          // through this endpoint.
          span_type: yupString().defined().test(
            "span-type",
            `span_type must be one of ${[...CLIENT_SYSTEM_SPAN_TYPES, ...SERVER_SYSTEM_SPAN_TYPES].join(", ")} or a custom name matching ${CUSTOM_TELEMETRY_NAME_RE}`,
            // yup skips tests for undefined values, so `value` is always set here.
            (value) => (CLIENT_SYSTEM_SPAN_TYPES as readonly string[]).includes(value) || (SERVER_SYSTEM_SPAN_TYPES as readonly string[]).includes(value) || CUSTOM_TELEMETRY_NAME_RE.test(value),
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
          // See the event-level http_client_span_id above.
          http_client_span_id: yupString().optional().matches(UUID_RE, "Invalid http_client_span_id"),
        }).defined().test(
          "span-interval",
          "ended_at_ms must be greater than or equal to started_at_ms",
          (span) => span.ended_at_ms == null || span.ended_at_ms >= span.started_at_ms,
        ).test(
          "page-view-span-parent",
          "A $page-view span must not carry page_view_span_id, http_client_span_id, or parent_span_ids, and a span must not name itself as its page_view_span_id",
          // The parent_span_ids null check looks redundant (the field is
          // declared defined), but yup runs object-level tests even when field
          // validation is failing, so a span item missing parent_span_ids
          // still reaches this test. Missing = compliant here; the field-level
          // `defined()` error rejects the request either way.
          (span) => (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            span.span_type !== PAGE_VIEW_SPAN_TYPE || (span.page_view_span_id == null && span.http_client_span_id == null && (span.parent_span_ids == null || span.parent_span_ids.length === 0))
          ) && (span.page_view_span_id == null || span.page_view_span_id !== span.span_id),
        ).test(
          "http-client-span-parent",
          "A $http-client span must not carry http_client_span_id, and a span must not name itself as its http_client_span_id",
          (span) => (
            span.span_type !== HTTP_CLIENT_SPAN_TYPE || span.http_client_span_id == null
          ) && (span.http_client_span_id == null || span.http_client_span_id !== span.span_id),
        ),
      ).optional().max(MAX_SPANS),
    }).defined().test(
      "non-empty-batch",
      "A batch must contain at least one event or span",
      (body) => (body.events?.length ?? 0) + (body.spans?.length ?? 0) >= 1,
    ).test(
      "single-parent-path",
      "parent_span_ids must describe one ancestry path without duplicates or self-parenting",
      // This cross-item test runs on the raw cast value even while item-level
      // field validation is failing (yup runs a parent schema's tests
      // regardless of child errors), so it must tolerate malformed items:
      // anything not shaped well enough for the path check is skipped here and
      // rejected by its own field-level errors instead.
      (body) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const spans = Array.isArray(body.spans) ? body.spans.filter((span) => span != null && typeof span.span_id === "string" && Array.isArray(span.parent_span_ids)) : [];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const events = Array.isArray(body.events) ? body.events.filter((event) => event != null && (event.parent_span_ids == null || Array.isArray(event.parent_span_ids))) : [];
        return getBatchParentPathError(spans, events) === null;
      },
    ).transform((_value, originalValue) => maybeDecodeBinaryBody(originalValue)),
  }).test(
    // Auth-type-dependent body rules live here in the schema (not the handler) so
    // the request contract is fully declared in one place. They must be
    // request-level tests because they need auth.type, which field-level schemas
    // inside `body` can't see.
    //
    // The `req.auth == null || req.body == null` guards look redundant (the
    // schema declares both as defined), but they're not: yup skips a schema's
    // own tests when its value is null, yet it still runs the PARENT object's
    // tests — so when an unauthenticated request (auth: null) or a literal
    // `null` JSON body fails the child's nullability check, these request-level
    // tests still execute with the null child. Without the guards that's a
    // TypeError -> 500 instead of the intended validation error (e.g. the
    // KnownErrors.AccessTypeRequired that smart-request derives from the auth
    // nullability violation).
    "client-auth-derives-identity",
    "user_id / refresh_token_id / session_replay_id must not be set with client auth; they are derived from the session",
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (req) => req.auth == null || req.body == null || req.auth.type !== "client" || (req.body.user_id == null && req.body.refresh_token_id == null && req.body.session_replay_id == null),
  ).test(
    "client-auth-requires-segment",
    "session_replay_segment_id is required for analytics batches with client auth",
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (req) => req.auth == null || req.body == null || req.auth.type !== "client" || req.body.session_replay_segment_id != null,
  ).test(
    // The shared taxonomy is the single trust boundary for signal writers.
    // This prevents browser callers from forging server instrumentation and
    // server callers from inventing browser-only interaction signals.
    "telemetry-signal-write-permissions",
    "The authenticated SDK tier is not allowed to write one or more telemetry signal types",
    (req) => {
      // Yup executes parent tests even when a required child is malformed.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (req.auth == null || req.body == null) return true;
      const origin = req.auth.type === "client" ? "client" : "server";
      const eventsAllowed = !Array.isArray(req.body.events) || req.body.events.every(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (event) => event == null || typeof event.event_type !== "string" || canWriteTelemetrySignal(event.event_type, "event", origin),
      );
      const spansAllowed = !Array.isArray(req.body.spans) || req.body.spans.every(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (span) => span == null || typeof span.span_type !== "string" || canWriteTelemetrySignal(span.span_type, "span", origin),
      );
      return eventsAllowed && spansAllowed;
    },
  ),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      // Both counts cross the ClickHouse acceptance boundary before the route
      // responds. `accepted_spans` keeps the existing response field name even
      // though span insertion is now synchronous and observable by the caller.
      inserted: yupNumber().defined(),
      accepted_spans: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!isTelemetryResource(body.resource)) {
      throw new HexclaveAssertionError("The request schema accepted an invalid telemetry resource");
    }
    const resource = body.resource;

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
      // The server SDK must forward the caller's refresh token explicitly.
      // Treating an incidental user token on a server-authenticated request as
      // telemetry context can associate server work with the operator running
      // it. Admin/session sends may still use their own authenticated context.
      refreshTokenId = body.refresh_token_id ?? (auth.type === "admin" ? auth.refreshTokenId ?? null : null);
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

    const refundItem = async (
      itemId: MeteredPlanItemId,
      quantity: number,
      captureKey: string,
    ) => {
      if (billingTeamId == null || quantity === 0) return;
      try {
        await increasePlanItemQuantity(billingTeamId, itemId, quantity);
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
    const billableEventCount = events.filter(
      (event) => classifyTelemetrySignal(event.event_type, "event").billingItem === "analytics_events",
    ).length;
    const billableSpanCount = spans.filter(
      (span) => classifyTelemetrySignal(span.span_type, "span").billingItem === "analytics_spans",
    ).length;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    let eventsBillingTeamIdForRefund: string | null = null;
    let spansBillingTeamIdForRefund: string | null = null;
    if (billingTeamId != null && arePlanLimitsEnforced()) {
      const debitResult = await tryDecreasePlanItemQuantities(billingTeamId, [
        { itemId: ITEM_IDS.analyticsEvents, quantity: billableEventCount },
        { itemId: ITEM_IDS.analyticsSpans, quantity: billableSpanCount },
      ]);
      if (debitResult.insufficientItemId != null) {
        const requestedQuantity = debitResult.insufficientItemId === ITEM_IDS.analyticsEvents
          ? billableEventCount
          : billableSpanCount;
        throw new KnownErrors.ItemQuantityInsufficientAmount(
          debitResult.insufficientItemId,
          billingTeamId,
          requestedQuantity,
        );
      }
      eventsBillingTeamIdForRefund = billableEventCount > 0 ? billingTeamId : null;
      spansBillingTeamIdForRefund = billableSpanCount > 0 ? billingTeamId : null;
    }

    // Shared (never-closed) client: this is the batch-ingest hot path, where a
    // per-request connection pool would leak sockets and cost a handshake.
    const clickhouseClient = getSharedClickhouseAdminClient();

    // The producer/runtime stamps come from the ROUTE (never the client), so a
    // client cannot spoof platform-produced rows or clear the defaults.
    const runtime = auth.type === "client" ? "browser" : "server";
    try {
      const spanRows = buildBatchSpanRows({
        spans,
        resource,
        projectId,
        branchId,
        userId,
        refreshTokenId,
        sessionReplayId,
        sessionReplaySegmentId,
        serverNowMs: Date.now(),
      });

      // Each destination has its own stable deduplication token, so all
      // independent ClickHouse writes can run concurrently. A partial commit
      // is safe: the request refunds quota, then a retry no-ops at destinations
      // that already accepted this batch.
      await Promise.all([
        insertBatchEvents(clickhouseClient, events, {
          projectId,
          branchId,
          userId,
          refreshTokenId,
          sessionReplayId,
          sessionReplaySegmentId,
          runtime,
          resource,
        }, body.batch_id),
        insertSpans(clickhouseClient, spanRows, {
          deduplicationToken: getBatchDestinationDeduplicationToken(body.batch_id, "analytics_internal.spans"),
        }),
      ]);
    } catch (error) {
      await Promise.all([
        eventsBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsEvents, billableEventCount, "analytics-events-clickhouse-refund"),
        spansBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsSpans, billableSpanCount, "analytics-spans-clickhouse-refund"),
      ]);
      throw error;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: events.length, accepted_spans: spans.length },
    };
  },
});
