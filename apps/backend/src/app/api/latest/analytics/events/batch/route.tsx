import { buildTelemetryWritePlan, getBatchDestinationDeduplicationToken, insertBatchEvents, normalizeBatchEvents, type NormalizedEventBatch } from "@/lib/analytics-telemetry-writers";
import { evaluateErrorIngestPolicy, persistErrorIngestClientReportProjection } from "@/lib/error-ingest";
import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { createLegacyBatchProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { increasePlanItemQuantity, tryDecreasePlanItemQuantities, type MeteredPlanItemId } from "@/lib/plan-metering";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { buildTelemetryMaterializationMessage, enqueueQstashMessage } from "@/lib/qstash-outbox";
import { buildBatchSpanLinkRows, buildBatchSpanRows, getBatchDuplicateSpanIdError, insertSpanLinks, insertSpans } from "@/lib/spans";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { CLIENT_SYSTEM_SPAN_TYPES, CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_NAME_RE, LOG_LEVELS, SYSTEM_EVENT_TYPES, TELEMETRY_MAX_LOG_MESSAGE_BYTES, TELEMETRY_SCOPE_NAME_MAX_BYTES, TELEMETRY_SCOPE_VERSION_MAX_BYTES, TELEMETRY_SPAN_KINDS, TELEMETRY_SPAN_STATUS_CODES, TELEMETRY_SPAN_STATUS_MESSAGE_MAX_BYTES, TELEMETRY_UUID_RE, W3C_SPAN_ID_RE, W3C_TRACE_ID_RE, canWriteTelemetrySignal, classifyTelemetrySignal, getTelemetryResourceError, isTelemetryResource, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { Buffer } from "node:buffer";
import * as zlib from "node:zlib";

// Hoisted to shared so the SDK, the propagation-header codec, and this route
// validate identically — local drift 400s whole batches. UUIDs are for DATABASE
// identities only (batch/user/refresh-token/replay/segment ids); span identity is
// W3C trace context.
const UUID_RE = TELEMETRY_UUID_RE;

// The all-zero trace/span ids are explicitly invalid per the W3C spec, and the
// regexes alone would accept them. A row carrying one would look joinable but
// match nothing, so reject at the boundary instead of storing a poison value.
const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

function isUsableW3cTraceId(value: string): boolean {
  return W3C_TRACE_ID_RE.test(value) && value !== ALL_ZERO_TRACE_ID;
}

function isUsableW3cSpanId(value: string): boolean {
  return W3C_SPAN_ID_RE.test(value) && value !== ALL_ZERO_SPAN_ID;
}

const W3C_TRACE_ID_ERROR = "must be 32 lowercase hex characters and not all-zero";
const W3C_SPAN_ID_ERROR = "must be 16 lowercase hex characters and not all-zero";

const LOG_EVENT_TYPE = "$log";
const ERROR_EVENT_TYPE = "$error";

const errorIngestClientReportEntrySchema = yupObject({
  reason: yupString().defined(),
  category: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const errorIngestClientReportSchema = yupObject({
  discarded_events: yupArray(errorIngestClientReportEntrySchema).defined(),
  rate_limited_events: yupArray(errorIngestClientReportEntrySchema).defined(),
  filtered_events: yupArray(errorIngestClientReportEntrySchema).defined(),
  filtered_sampling_events: yupArray(errorIngestClientReportEntrySchema).defined(),
}).defined();

const errorIngestProtocolItemSchema = yupObject({
  itemIndex: yupNumber().defined(),
  itemId: yupString().defined(),
  itemType: yupString().defined(),
  eventId: yupString().optional(),
  status: yupString().defined(),
  reason: yupString().optional(),
  canonicalItemId: yupString().optional(),
  retryAfterMs: yupNumber().optional(),
  category: yupString().defined(),
  clientReportBucket: yupString().optional(),
  clientReportReason: yupString().optional(),
  rejectedByOtlp: yupBoolean().defined(),
}).defined();

const errorIngestCountsSchema = yupObject({
  accepted: yupNumber().defined(),
  filtered: yupNumber().defined(),
  rate_limited: yupNumber().defined(),
  rejected: yupNumber().defined(),
  deduplicated: yupNumber().defined(),
  dropped: yupNumber().defined(),
  queued: yupNumber().defined(),
}).defined();

/**
 * Field-level contract for `$error` payloads.
 *
 * Deliberately permissive about EXTRA keys — the SDK adds mechanism metadata,
 * urls, route info, and (once source maps land) `debug_images`, and rejecting
 * unknown fields would make every SDK upgrade a breaking change. What it does
 * enforce is the type of the fields the server actually reads, so a
 * malformed payload is rejected at the boundary rather than silently producing
 * a degraded grouping hash. `handled` is required: missing must not become
 * `true`.
 */
function isValidErrorEventData(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (typeof data.name !== "string" || typeof data.message !== "string") return false;
  if (data.stack !== undefined && typeof data.stack !== "string") return false;
  if (typeof data.handled !== "boolean") return false;
  return true;
}

const MAX_EVENTS = 500;
const MAX_SPANS = 500;

// Links are a niche affordance; a low cap keeps one span from ballooning the batch
// (and the span_links insert) while staying far above any plausible real use.
const MAX_SPAN_LINKS = 32;
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
      // Versioned batches use the W3C identity contract. An omitted version is
      // the released pre-resource shape and is handled by the explicit legacy
      // compatibility test below; it must not be confused with a malformed
      // versioned request.
      schema_version: yupNumber().optional().integer().oneOf([3]),
      resource: yupMixed().optional().test(
        "telemetry-resource",
        "Invalid telemetry resource",
        (value) => value === undefined || getTelemetryResourceError(value) === null,
      ),
      sent_at_ms: yupNumber().defined().integer().min(0),
      // Server/admin auth only (see the request-level auth-type tests below):
      // attributes the batch to a user when there is no session access token to
      // derive one from.
      user_id: yupString().optional().matches(UUID_RE, "Invalid user_id"),
      // Server/admin auth only: the caller's resolved request context, forwarded
      // by the server SDK's withSpan({ request }) as scalar lifecycle correlation.
      // Cross-tier ancestry itself comes from W3C trace_id/parent_span_id.
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
          // The ENCLOSING span this event happened inside. An event is an instant,
          // so unlike a span it never roots a trace: both fields are absent for an
          // event recorded outside any span.
          trace_id: yupString().optional().test("event-trace-id", `trace_id ${W3C_TRACE_ID_ERROR}`, (value) => value === undefined || isUsableW3cTraceId(value)),
          span_id: yupString().optional().test("event-span-id", `span_id ${W3C_SPAN_ID_ERROR}`, (value) => value === undefined || isUsableW3cSpanId(value)),
          // CORRELATION, not ancestry: which `$page-view` span this event happened
          // on. Client tab state the server cannot derive, so it rides per-item (a
          // batch can straddle a navigation). Untrusted label, same trust model as
          // the segment id.
          page_view_span_id: yupString().optional().test("event-page-view-span-id", `page_view_span_id ${W3C_SPAN_ID_ERROR}`, (value) => value === undefined || isUsableW3cSpanId(value)),
          // `$log` items only: the human-readable message + log level.
          // Structured attributes ride in `data` like any other event.
          message: yupString().optional().test(
            "log-message-size",
            `message must be at most ${TELEMETRY_MAX_LOG_MESSAGE_BYTES} bytes`,
            (value) => value === undefined || Buffer.byteLength(value, "utf8") <= TELEMETRY_MAX_LOG_MESSAGE_BYTES,
          ),
          level: yupString().optional().oneOf(LOG_LEVELS),
        }).defined().test(
          // A lone trace_id or span_id cannot be joined to anything, so it is
          // malformed rather than partially useful.
          "event-span-identity-pairing",
          "trace_id and span_id must be provided together",
          (event) => (event.trace_id === undefined) === (event.span_id === undefined),
        ).test(
          "log-fields",
          `message/level are required for ${LOG_EVENT_TYPE} events and forbidden for any other event type`,
          (event) => event.event_type === LOG_EVENT_TYPE
            ? event.message !== undefined && event.level !== undefined
            : event.message === undefined && event.level === undefined,
        ).test(
          // `$error` is the one event type whose `data` the SERVER reads and
          // promotes into typed ClickHouse columns (`error_type`, `message`,
          // `error_culprit`) and feeds to the grouping algorithm. Everywhere
          // else `data` is opaque customer JSON, validated only for shape and
          // size. So it gets a field-level contract here rather than being
          // discovered at grouping time, where a wrong type would degrade the
          // hash instead of rejecting the item.
          "error-fields",
          `${ERROR_EVENT_TYPE} data must carry string name/message, optional string stack, and boolean handled`,
          (event) => event.event_type !== ERROR_EVENT_TYPE || isValidErrorEventData(event.data),
        ),
      ).optional().max(MAX_EVENTS),
      spans: yupArray(
        yupObject({
          // W3C identity, minted entirely by the SDK and stored verbatim.
          trace_id: yupString().defined().test("span-trace-id", `trace_id ${W3C_TRACE_ID_ERROR}`, (value) => isUsableW3cTraceId(value)),
          span_id: yupString().defined().test("span-span-id", `span_id ${W3C_SPAN_ID_ERROR}`, (value) => isUsableW3cSpanId(value)),
          // null means this span IS the trace root — one of the root activities
          // (a browser fetch, a page view, a bare withSpan, or a request that
          // arrived with no traceparent).
          parent_span_id: yupString().nullable().defined().test("span-parent-span-id", `parent_span_id ${W3C_SPAN_ID_ERROR}`, (value) => value == null || isUsableW3cSpanId(value)),
          // Custom operation names or client-writable system autocapture types.
          // Library spans put their actual operation here and carry their
          // tracer in scope_name.
          span_type: yupString().defined().test(
            "span-type",
            `span_type must be one of ${CLIENT_SYSTEM_SPAN_TYPES.join(", ")} or a custom name matching ${CUSTOM_TELEMETRY_NAME_RE}`,
            // yup skips tests for undefined values, so `value` is always set here.
            (value) => (CLIENT_SYSTEM_SPAN_TYPES as readonly string[]).includes(value) || CUSTOM_TELEMETRY_NAME_RE.test(value),
          ),
          started_at_ms: yupNumber().defined().integer().min(0),
          ended_at_ms: yupNumber().nullable().defined().integer().min(0),
          data: yupMixed().defined().test(
            "span-data",
            `Span data must be a JSON object of at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} serialized bytes`,
            (value) => isPlainObjectWithinLimit(value),
          ),
          updated_at_ms: yupNumber().defined().integer().min(0),
          scope_name: yupString().optional().test(
            "span-scope-name-size",
            `scope_name must be a non-empty string of at most ${TELEMETRY_SCOPE_NAME_MAX_BYTES} UTF-8 bytes`,
            (value) => value === undefined || (value !== "" && Buffer.byteLength(value, "utf8") <= TELEMETRY_SCOPE_NAME_MAX_BYTES),
          ),
          scope_version: yupString().optional().test(
            "span-scope-version-size",
            `scope_version must be a non-empty string of at most ${TELEMETRY_SCOPE_VERSION_MAX_BYTES} UTF-8 bytes`,
            (value) => value === undefined || (value !== "" && Buffer.byteLength(value, "utf8") <= TELEMETRY_SCOPE_VERSION_MAX_BYTES),
          ),
          // First-class OTel columns remain separate from opaque product data.
          kind: yupString().optional().oneOf([...TELEMETRY_SPAN_KINDS]),
          status_code: yupString().optional().oneOf([...TELEMETRY_SPAN_STATUS_CODES]),
          status_message: yupString().optional().test(
            "span-status-message-size",
            `status_message must be at most ${TELEMETRY_SPAN_STATUS_MESSAGE_MAX_BYTES} UTF-8 bytes`,
            (value) => value === undefined || Buffer.byteLength(value, "utf8") <= TELEMETRY_SPAN_STATUS_MESSAGE_MAX_BYTES,
          ),
          // See the event-level page_view_span_id above.
          page_view_span_id: yupString().optional().test("span-page-view-span-id", `page_view_span_id ${W3C_SPAN_ID_ERROR}`, (value) => value === undefined || isUsableW3cSpanId(value)),
          // Non-hierarchical references to other spans (see TrackOptions.links in
          // the SDK). A link may point into ANOTHER trace — that is the point.
          links: yupArray(
            yupObject({
              trace_id: yupString().defined().test("link-trace-id", `link trace_id ${W3C_TRACE_ID_ERROR}`, (value) => isUsableW3cTraceId(value)),
              span_id: yupString().defined().test("link-span-id", `link span_id ${W3C_SPAN_ID_ERROR}`, (value) => isUsableW3cSpanId(value)),
              // Trusted platform-only target scope. Ordinary SDK callers cannot
              // claim another project's rows; the request-level rule below is
              // the authorization boundary for these optional fields.
              linked_project_id: yupString().optional().min(1),
              linked_branch_id: yupString().optional().min(1),
            }).defined().test(
              "link-target-scope-pair",
              "linked_project_id and linked_branch_id must be provided together",
              (link) => (link.linked_project_id === undefined) === (link.linked_branch_id === undefined),
            ),
          ).optional().max(MAX_SPAN_LINKS),
        }).defined().test(
          "span-interval",
          "ended_at_ms must be greater than or equal to started_at_ms",
          (span) => span.ended_at_ms == null || span.ended_at_ms >= span.started_at_ms,
        ).test(
          // A self-parent is a one-node cycle: the tree builder would either loop or
          // have to silently drop the edge. Kept as its own test (rather than merged
          // with the page-view check below) so the 400 names the offending field —
          // a validation error that says "one of these two things" makes the caller
          // guess which.
          "span-self-parent",
          "A span must not name itself as its parent_span_id",
          (span) => span.parent_span_id == null || span.parent_span_id !== span.span_id,
        ).test(
          "span-self-page-view",
          "A span must not name itself as its page_view_span_id",
          (span) => span.page_view_span_id == null || span.page_view_span_id !== span.span_id,
        ),
      ).optional().max(MAX_SPANS),
    }).defined().test(
      "non-empty-batch",
      "A batch must contain at least one event or span",
      (body) => (body.events?.length ?? 0) + (body.spans?.length ?? 0) >= 1,
    ).test(
      // The only cross-item rule left: with a scalar parent there are no ancestry
      // PATHS to cross-check, but two rows sharing a span id in one batch would
      // silently collapse in the ReplacingMergeTree, losing one of them.
      //
      // This runs on the raw cast value even while item-level field validation is
      // failing (yup runs a parent schema's tests regardless of child errors), so
      // it tolerates malformed items: anything without a string span_id is skipped
      // here and rejected by its own field-level error instead.
      "unique-span-ids",
      "Two spans in one batch must not share a span_id",
      (body) => {
        const spanIds = (Array.isArray(body.spans) ? body.spans : [])
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cast type claims non-null items, but yup runs this before item validation
          .filter((span) => span != null && typeof span.span_id === "string")
          .map((span) => span.span_id);
        return new Set(spanIds).size === spanIds.length;
      },
    ).test(
      "wire-version",
      "Legacy analytics batches must omit versioned fields and contain only $page-view/$click events; versioned batches require schema_version 3 and a telemetry resource",
      (body) => {
        if (body.schema_version === undefined) {
          const events = Array.isArray(body.events) ? body.events : [];
          return body.resource === undefined
            && body.spans === undefined
            && body.user_id === undefined
            && body.refresh_token_id === undefined
            && body.session_replay_id === undefined
            && body.session_replay_segment_id !== undefined
            && events.length > 0
            // Yup can run this parent test before child item validation.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            && events.every((event) => event != null && (event.event_type === "$page-view" || event.event_type === "$click"));
        }
        return body.schema_version === 3 && isTelemetryResource(body.resource);
      },
    ).test(
      // Body-level rather than item-level because it is wire-version-dependent:
      // the released pre-versioned contract accepted ANY JSON value as `data`
      // (yupMixed) with no size cap, and old SDKs are embedded in customer apps
      // indefinitely, so that leniency is permanent for legacy batches — a 400
      // here would reject the whole batch for every old caller forever. Legacy
      // non-object data is wrapped into an object at the write boundary (the
      // telemetry `data` column is typed JSON and only stores objects); the
      // strict plain-object + size contract applies to versioned batches only.
      "custom-event-data",
      `Event data must be a JSON object of at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} serialized bytes`,
      (body) => {
        if (body.schema_version === undefined) return true;
        const events = Array.isArray(body.events) ? body.events : [];
        // Yup can run this parent test before child item validation.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return events.every((event) => event == null || isPlainObjectWithinLimit(event.data));
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
        // An instrumentation scope is server-only. Browsers may define custom
        // span names, but cannot label them as trusted library instrumentation
        // to bypass billing or customer-authored-span classification.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (span) => span == null
          || typeof span.span_type !== "string"
          || (canWriteTelemetrySignal(span.span_type, "span", origin)
            // Instrumentation scope (name + version) is server-only. Browsers
            // may set kind/status on their own spans, but cannot label them as
            // trusted library instrumentation.
            && (span.scope_name === undefined || origin === "server")
            && (span.scope_version === undefined || origin === "server")),
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
      // Additive only: this branch is reserved for item-level normalization
      // once the request schema stops rejecting the whole batch up front.
      ingest: yupObject({
        status: yupString().defined(),
        counts: errorIngestCountsSchema,
        outcomes: yupArray(errorIngestProtocolItemSchema).defined(),
        client_report: errorIngestClientReportSchema,
        idempotency_key: yupString().defined(),
      }).defined().optional(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    let resource: TelemetryResource | null;
    if (body.schema_version === undefined) {
      resource = null;
    } else {
      if (!isTelemetryResource(body.resource)) {
        throw new HexclaveAssertionError("The request schema accepted an invalid telemetry resource");
      }
      resource = body.resource;
    }

    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }

    let events = body.events ?? [];
    const spans = body.spans ?? [];
    const tenancyId = auth.tenancy.id;
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;

    // Keep this rollout at the legacy batch seam. OTLP retains its existing
    // request contract until it can expose the same item-level outcomes; this
    // avoids silently changing a different protocol in the same change.
    //
    // The error-ingest policy (scrubbing, filters, sampling, rate limits) is an
    // error-pipeline control, so it applies to `$error`/`$log` items only.
    // Product analytics items ($page-view, $click, custom events, and all
    // spans) are stored byte-identical to what the SDK captured: scrubbing them
    // would silently rewrite customer analytics (e.g. redact query strings out
    // of $page-view URLs) and create a permanent discontinuity for exact-match
    // dashboard queries — and error-policy limits must not drop analytics
    // traffic either.
    //
    // Results are matched back by itemId, NOT via accepted*Indexes: those are
    // positions in the items array handed to the policy, which do not line up
    // with positions in `events` once the policy sees a subset (and never lined
    // up with positions in `spans`, which used to silently drop every span in
    // a batch that also contained events).
    const isErrorIngestPolicyEvent = (event: { event_type: string }) =>
      event.event_type === ERROR_EVENT_TYPE || event.event_type === LOG_EVENT_TYPE;
    const policyItems = events.flatMap((event, index) =>
      isErrorIngestPolicyEvent(event)
        ? [{ itemId: `event:${index}`, itemType: event.event_type === LOG_EVENT_TYPE ? "log" as const : "event" as const, data: event.data }]
        : []);
    const policyDecision = evaluateErrorIngestPolicy({
      config: auth.tenancy.config,
      scope: { tenancyId, projectId, branchId },
      items: policyItems,
      nowMs: new Date().getTime(),
    });
    const acceptedPolicyItemIds = new Set(policyDecision.acceptedItemIds);
    events = events
      .map((event, index) => {
        const scrubbedData = policyDecision.scrubbedData.get(`event:${index}`);
        return scrubbedData === undefined ? event : { ...event, data: scrubbedData };
      })
      .filter((event, index) => !isErrorIngestPolicyEvent(event) || acceptedPolicyItemIds.has(`event:${index}`));

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

    const hasExplicitLinkTarget = spans.some((span) =>
      (span.links ?? []).some((link) => link.linked_project_id !== undefined));
    if (hasExplicitLinkTarget && (auth.type === "client" || projectId !== "internal")) {
      throw new StatusError(StatusError.BadRequest, "Cross-project span link targets are reserved for the internal platform backend");
    }

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
      // Auto-instrumented library spans carry an authenticated server-only
      // scope_name. Their operation-shaped span_type must not turn that
      // automatic work into billable custom spans.
      (span) => span.scope_name === undefined
        && classifyTelemetrySignal(span.span_type, "span").billingItem === "analytics_spans",
    ).length;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    let eventsBillingTeamIdForRefund: string | null = null;
    let spansBillingTeamIdForRefund: string | null = null;
    // The internal project is the platform's own observability sink, not a
    // customer billing scope. Metering it would make telemetry ingestion
    // depend on Bulldozer and create a startup failure loop: the backend emits
    // a request span, its batch waits for the billing service, and a billing
    // outage turns the telemetry batch itself into a 500. Customer projects
    // continue through the normal fail-closed quota path below.
    if (projectId !== "internal" && billingTeamId != null && arePlanLimitsEnforced()) {
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
    let normalizedEvents: NormalizedEventBatch | null = null;
    try {
      const spanRows = resource === null ? [] : buildBatchSpanRows({
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
      const spanLinkRows = resource === null ? [] : buildBatchSpanLinkRows({ spans, projectId, branchId });

      // Normalized once, up front. Grouping every `$error` in the batch is the
      // only CPU-bound step in this handler, and the result is needed twice:
      // by the ClickHouse insert below and by the Issue materialization that
      // runs after it. Normalizing inside the insert (as this used to) would
      // have meant recomputing it.
      normalizedEvents = normalizeBatchEvents(events, {
        projectId,
        branchId,
        userId,
        refreshTokenId,
        sessionReplayId,
        sessionReplaySegmentId,
        runtime,
        resource,
        // The authenticated SDK path is always an SDK producer. Metering is
        // decided above; internal platform telemetry is explicitly unmetered.
        producer: "sdk",
        groupingConfig: auth.tenancy.config.observability.errorGrouping,
      }, body.batch_id);

      // Queue control-plane work before the ClickHouse write. If the process
      // dies after this insert, QStash retries until the referenced batch is
      // visible; if the ClickHouse write fails, the job has no issue rows to
      // apply and eventually reaches its normal delivery failure state.
      if (normalizedEvents.issueInputs.length > 0) {
        await enqueueQstashMessage(buildTelemetryMaterializationMessage({
          tenancyId: auth.tenancy.id,
          batchId: body.batch_id,
        }));
      }

      // Each destination has its own stable deduplication token, so all
      // independent ClickHouse writes can run concurrently. A partial commit
      // is safe: the request refunds quota, then a retry no-ops at destinations
      // that already accepted this batch.
      await Promise.all([
        insertBatchEvents(clickhouseClient, buildTelemetryWritePlan(normalizedEvents, body.batch_id)),
        insertSpans(clickhouseClient, spanRows, {
          deduplicationToken: getBatchDestinationDeduplicationToken(body.batch_id, "analytics_internal.spans"),
        }),
        // No dedup token: span_links is a ReplacingMergeTree keyed by the link's
        // full identity, so a retried batch collapses on its own key rather than
        // needing insert-level deduplication.
        insertSpanLinks(clickhouseClient, spanLinkRows),
      ]);
    } catch (error) {
      await Promise.all([
        eventsBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsEvents, billableEventCount, "analytics-events-clickhouse-refund"),
        spansBillingTeamIdForRefund == null ? Promise.resolve() : refundItem(ITEM_IDS.analyticsSpans, billableSpanCount, "analytics-spans-clickhouse-refund"),
      ]);
      throw error;
    }

    // Policy outcomes only exist for `$error`/`$log` items. A batch with none
    // of those must fall back to the counts-based accepted projection: handing
    // the projection an empty outcome list would classify the whole (perfectly
    // fine) analytics batch as `rejected: empty_batch` in the client-report
    // ledger and sprout a bogus `ingest` block in the response.
    const protocolProjection = createLegacyBatchProtocolProjection(
      body.batch_id,
      body.events?.length ?? 0,
      spans.length,
      policyItems.length > 0 ? policyDecision.outcomes : undefined,
    );
    runAsynchronouslyAndWaitUntil(persistErrorIngestClientReportProjection(
      {
        tenancyId: auth.tenancy.id,
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
      },
      "legacy_batch",
      protocolProjection,
    ));
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        // Report the number of event rows that survived policy filtering. The
        // previous request-count value over-reported storage when a versioned
        // batch dropped or rate-limited an error/log item.
        // Item-level outcomes for versioned callers live in `ingest` below.
        inserted: events.length,
        accepted_spans: spans.length,
        ...(protocolProjection.status === "accepted" ? {} : {
          ingest: {
            status: protocolProjection.status,
            counts: { ...protocolProjection.counts },
            // Yup's JSON response schema models arrays as mutable values;
            // materialize the adapter's readonly projection only at this
            // serialization boundary without changing its source contract.
            outcomes: [...protocolProjection.items],
            client_report: {
              discarded_events: [...protocolProjection.clientReport.discarded_events],
              rate_limited_events: [...protocolProjection.clientReport.rate_limited_events],
              filtered_events: [...protocolProjection.clientReport.filtered_events],
              filtered_sampling_events: [...protocolProjection.clientReport.filtered_sampling_events],
            },
            idempotency_key: protocolProjection.idempotencyKey,
          },
        }),
      },
    };
  },
});
