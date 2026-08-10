import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { HTTP_CLIENT_SPAN_TYPE, uuidToW3cSpanId, uuidToW3cTraceId, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { buildTelemetryResourceFields } from "./telemetry-resource";

/**
 * Spans are telemetry facts (time intervals) — the sibling of events. They are
 * written DIRECTLY to ClickHouse (`analytics_internal.spans`), the same way
 * events are, and never go through the ext-db-sync (that is a dimension
 * replicator, not a telemetry pipe). See the plan/notes in
 * `apps/backend/scripts/clickhouse-migrations.ts` for the table + `default.spans` view.
 *
 * Span IDENTITY IS W3C trace context: a 32-hex `trace_id`, a 16-hex `span_id`, and
 * one nullable `parent_span_id` (null = trace root). There is no id namespacing
 * and no ancestor arrays; ids arrive final and are stored verbatim. The old
 * session → replay → tab → page hierarchy is represented with those same
 * scalar ids: the refresh root is projected from the synced dimension, while
 * replay/segment rows are materialized by replay ingestion.
 */

/**
 * One row of `analytics_internal.spans`. `created_at` is omitted (the table
 * defaults it to now64(3) = ingested-at). `version` decides which row the
 * ReplacingMergeTree keeps per span_id (highest wins) and MUST come from a named
 * version builder in this file (`clientUpdatedAtSpanVersion`) rather than inline
 * math: mixing versioning schemes for one span id silently corrupts upserts.
 */
export type SpanInsertRow = {
  trace_id: string,
  span_id: string,
  span_type: string,
  started_at: Date,
  ended_at: Date | null,
  /** null = this span IS the trace root; the trace_roots MV keys off exactly this. */
  parent_span_id: string | null,
  data: string,
  kind: "internal" | "server" | "client" | "producer" | "consumer",
  service_namespace: string | null,
  service_name: string,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  resource_attributes: string,
  scope_name?: string | null,
  scope_version?: string | null,
  // Always 'sdk' on this path: every row uses the normal authenticated SDK
  // ingestion architecture. This includes Hexclave backend telemetry, which is
  // owned by the internal project and is explicitly unmetered by the route.
  // Explicit rather than relying on the column default so the billing filter
  // in span_writes_mv never depends on a DEFAULT staying in sync.
  producer: "sdk" | "hexclave-backend",
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: string | null,
  refresh_token_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  /** CORRELATION: which `$page-view` span this row happened on, when known. */
  page_view_span_id: string | null,
  version: number,
};

export async function insertSpans(
  client: ClickHouseClient,
  rows: SpanInsertRow[],
  options?: { deduplicationToken?: string },
): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({
    table: "analytics_internal.spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: options?.deduplicationToken == null ? 1 : 0,
      wait_for_async_insert: 1,
      ...options?.deduplicationToken == null
        ? {}
        : { insert_deduplication_token: options.deduplicationToken },
    },
  });
}

export const SESSION_LIFECYCLE_SPAN_TYPES = {
  replay: "$session-replay",
  segment: "$session-replay-segment",
} as const;

/**
 * Replay and segment bounds only widen, so their end timestamp is a monotonic
 * ReplacingMergeTree version even when batches arrive out of order.
 */
export function monotoneEndSpanVersion(spanEndedAt: Date): number {
  return spanEndedAt.getTime();
}

/**
 * One span as it arrives on the wire from the SDK (inside the analytics events
 * batch): either a user-defined custom span, a client-minted system autocapture
 * span ($page-view/$away/$offline/$http-client), or a server-SDK library
 * operation carrying its OTel tracer in `scope_name`.
 *
 * Identity is W3C and arrives COMPLETE: the SDK owns `trace_id`, `span_id` and
 * `parent_span_id` (null = trace root), and this route never rewrites them.
 * `page_view_span_id` is correlation in addition to ancestry — it names the `$page-view`
 * span the item happened on, which is client tab state the server cannot derive,
 * so it rides per-item (a batch can straddle a navigation).
 */
export type BatchSpanWireItem = {
  trace_id: string,
  span_id: string,
  parent_span_id: string | null,
  span_type: string,
  started_at_ms: number,
  ended_at_ms: number | null,
  data: unknown,
  updated_at_ms: number,
  /** Server-authenticated OTel instrumentation scope; absent for native custom/system spans. */
  scope_name?: string | null,
  page_view_span_id?: string | null,
  links?: {
    trace_id: string,
    span_id: string,
    linked_project_id?: string,
    linked_branch_id?: string,
  }[] | null,
};

/**
 * One row of `analytics_internal.span_links` — a non-hierarchical reference from
 * one span to another (see TrackOptions.links in the SDK). Kept separate from the
 * span row because links are many-per-span and the table is keyed by the link's
 * full identity.
 */
export type SpanLinkInsertRow = {
  project_id: string,
  branch_id: string,
  trace_id: string,
  owner_span_id: string,
  linked_trace_id: string,
  linked_span_id: string,
  linked_project_id: string,
  linked_branch_id: string,
};

/**
 * Duplicate-detection is all that survives of the old cross-item validation: with
 * a scalar parent there are no ancestry PATHS to cross-check, so the remaining
 * per-item rules (hex shape, all-zero rejection, parent != self) are field-level
 * and live in the route schema. Two rows sharing a span id in one batch would
 * silently collapse in the ReplacingMergeTree, so it is still worth rejecting.
 */
export function getBatchDuplicateSpanIdError(spans: readonly BatchSpanWireItem[]): string | null {
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.span_id)) return `Duplicate span_id ${JSON.stringify(span.span_id)} in one batch`;
    seen.add(span.span_id);
  }
  return null;
}

// How far into the future a client-supplied `updated_at_ms` may run before we
// clamp it. A skewed clock only corrupts ordering among that user's own span
// re-writes; the clamp just bounds how long a bogus future version could mask
// legitimate later updates.
const CUSTOM_SPAN_VERSION_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Version builder for SDK-created custom spans: the client's `updated_at_ms`,
 * clamped to [1, serverNow + 5min]. Custom spans re-write their `data` while
 * still open, so an end-time-derived version is unusable here — two data
 * re-writes of an open span would collide at the same (null-end-derived) version.
 * The SDK bumps `updated_at_ms` on every mutation, making it per-span monotonic,
 * so the latest client-side state wins in the ReplacingMergeTree regardless of
 * insert order.
 */
export function clientUpdatedAtSpanVersion(updatedAtMs: number, serverNowMs: number): number {
  return Math.min(Math.max(updatedAtMs, 1), serverNowMs + CUSTOM_SPAN_VERSION_MAX_FUTURE_MS);
}

/**
 * Builds `analytics_internal.spans` rows for SDK-sent wire spans (custom spans,
 * client-minted system autocapture spans, and server library operations).
 *
 * Identity passes through UNTOUCHED — `trace_id`, `span_id` and `parent_span_id`
 * are exactly what the SDK sent. Session and page identity are also stamped as
 * scalar correlation columns for direct filtering.
 *
 * The version is the client's `updated_at_ms` — per-span monotonic by SDK
 * construction, so the row carrying the latest update wins in the
 * ReplacingMergeTree regardless of insert order (an end row can never be shadowed
 * by a late-arriving open row). An end-time-as-version scheme is unusable here:
 * two data re-writes while the span is still open would collide at the same
 * version.
 */
export function buildBatchSpanRows(opts: {
  spans: BatchSpanWireItem[],
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  resource: TelemetryResource,
  serverNowMs: number,
}): SpanInsertRow[] {
  const duplicateError = getBatchDuplicateSpanIdError(opts.spans);
  if (duplicateError !== null) {
    throw new HexclaveAssertionError(duplicateError);
  }

  return opts.spans.map((span) => {
    // A `$page-view` span IS the page, so naming itself as its own page would make
    // the correlation column self-referential. The route schema rejects this;
    // assert so a future non-route caller cannot reintroduce it.
    if (span.page_view_span_id != null && span.page_view_span_id === span.span_id) {
      throw new HexclaveAssertionError("A span must not name itself as its page_view_span_id");
    }
    // Same reasoning for self-parenting: the route schema rejects it, and a
    // self-parented row would make the dashboard's cycle-cut logic do real work
    // for what is really malformed input.
    if (span.parent_span_id != null && span.parent_span_id === span.span_id) {
      throw new HexclaveAssertionError("A span must not name itself as its parent_span_id");
    }
    return {
      trace_id: span.trace_id,
      span_id: span.span_id,
      parent_span_id: span.parent_span_id,
      span_type: span.span_type,
      started_at: new Date(span.started_at_ms),
      ended_at: span.ended_at_ms == null ? null : new Date(span.ended_at_ms),
      data: JSON.stringify(stripLoneSurrogates(span.data)),
      // The SDK wire format predates an explicit OpenTelemetry span kind.
      // HTTP autocapture is nevertheless unambiguously a client operation;
      // persisting it as such keeps service-level workload metrics honest.
      kind: span.span_type === HTTP_CLIENT_SPAN_TYPE ? "client" : "internal",
      scope_name: span.scope_name ?? null,
      scope_version: null,
      ...buildTelemetryResourceFields(opts.resource),
      producer: "sdk" as const,
      project_id: opts.projectId,
      branch_id: opts.branchId,
      user_id: opts.userId,
      team_id: null,
      refresh_token_id: opts.refreshTokenId,
      session_replay_id: opts.sessionReplayId,
      session_replay_segment_id: opts.sessionReplaySegmentId,
      page_view_span_id: span.page_view_span_id ?? null,
      version: clientUpdatedAtSpanVersion(span.updated_at_ms, opts.serverNowMs),
    };
  });
}

/** Flattens every wire span's `links` into `analytics_internal.span_links` rows. */
export function buildBatchSpanLinkRows(opts: {
  spans: BatchSpanWireItem[],
  projectId: string,
  branchId: string,
}): SpanLinkInsertRow[] {
  return opts.spans.flatMap((span) => (span.links ?? []).map((link) => ({
    project_id: opts.projectId,
    branch_id: opts.branchId,
    // The OWNER's trace, not the link target's: the table is read as "which links
    // does this trace's span have", so keying by the target's trace would hide
    // every cross-trace link from the trace that actually declared it.
    trace_id: span.trace_id,
    owner_span_id: span.span_id,
    linked_trace_id: link.trace_id,
    linked_span_id: link.span_id,
    // Public SDK links have no target-tenancy claim surface and therefore stay
    // inside their authenticated owner scope. Only the internal platform SDK
    // can send the explicitly validated override fields.
    linked_project_id: link.linked_project_id ?? opts.projectId,
    linked_branch_id: link.linked_branch_id ?? opts.branchId,
  })));
}

export async function insertSpanLinks(client: ClickHouseClient, rows: SpanLinkInsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({
    table: "analytics_internal.span_links",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { date_time_input_format: "best_effort", async_insert: 1, wait_for_async_insert: 1 },
  });
}

/**
 * Materializes the two server-resolved lifecycle levels between the virtual
 * refresh-token root and browser page views. The browser already parents each
 * page under the deterministic segment span id; ingestion is the first tier
 * that knows which durable replay owns that segment, so it supplies the two
 * missing immediate-parent edges here.
 */
export async function insertSessionReplaySpans(
  client: ClickHouseClient,
  opts: {
    projectId: string,
    branchId: string,
    replayId: string,
    sessionReplaySegmentId: string,
    projectUserId: string,
    refreshTokenId: string,
    replayStartedAt: Date,
    replayLastEventAt: Date,
    segmentStartedAt: Date,
    segmentLastEventAt: Date,
    resource: TelemetryResource,
  },
): Promise<void> {
  const traceId = uuidToW3cTraceId(opts.refreshTokenId);
  const base = {
    trace_id: traceId,
    data: "{}",
    kind: "internal" as const,
    scope_name: null,
    scope_version: null,
    ...buildTelemetryResourceFields(opts.resource),
    producer: "sdk" as const,
    project_id: opts.projectId,
    branch_id: opts.branchId,
    user_id: opts.projectUserId,
    team_id: null,
    refresh_token_id: opts.refreshTokenId,
    session_replay_id: opts.replayId,
    page_view_span_id: null,
  } as const;

  const replaySpan: SpanInsertRow = {
    ...base,
    span_id: uuidToW3cSpanId(opts.replayId),
    span_type: SESSION_LIFECYCLE_SPAN_TYPES.replay,
    started_at: opts.replayStartedAt,
    ended_at: opts.replayLastEventAt,
    parent_span_id: uuidToW3cSpanId(opts.refreshTokenId),
    session_replay_segment_id: null,
    version: monotoneEndSpanVersion(opts.replayLastEventAt),
  };

  const segmentSpan: SpanInsertRow = {
    ...base,
    span_id: uuidToW3cSpanId(opts.sessionReplaySegmentId),
    span_type: SESSION_LIFECYCLE_SPAN_TYPES.segment,
    started_at: opts.segmentStartedAt,
    ended_at: opts.segmentLastEventAt,
    parent_span_id: replaySpan.span_id,
    session_replay_segment_id: opts.sessionReplaySegmentId,
    version: monotoneEndSpanVersion(opts.segmentLastEventAt),
  };

  await insertSpans(client, [replaySpan, segmentSpan]);
}
