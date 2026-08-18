import {
  uuidToW3cSpanId,
  uuidToW3cTraceId,
  type TelemetryResource,
  type TelemetrySpanKind,
  type TelemetrySpanStatusCode,
} from "@hexclave/shared/dist/utils/analytics-wire";
import { type ClickHouseClient } from "./clickhouse";
import { buildTelemetryResourceFields } from "./telemetry/resource";

/**
 * Spans are telemetry facts (time intervals) — the sibling of events. They are
 * written DIRECTLY to ClickHouse (`analytics_internal.spans`), the same way
 * events are, and never go through the ext-db-sync (that is a dimension
 * replicator, not a telemetry pipe). See
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
 * version builder (`monotoneEndSpanVersion` here, or the OTLP trace writer's
 * equivalent) rather than inline math: mixing versioning schemes for one span id
 * silently corrupts upserts.
 */
export type SpanInsertRow = {
  trace_id: string,
  span_id: string,
  span_type: string,
  /** Server-derived billing classification; clients and OTLP attributes cannot set it. */
  billing_item: "analytics_spans" | null,
  started_at: Date,
  ended_at: Date | null,
  /** null = this span IS the trace root; the trace_roots MV keys off exactly this. */
  parent_span_id: string | null,
  trace_state?: string,
  trace_flags?: number,
  start_time_unix_nano?: string,
  end_time_unix_nano?: string,
  data: string,
  kind: TelemetrySpanKind,
  status_code: TelemetrySpanStatusCode,
  status_message: string | null,
  service_namespace: string | null,
  service_name: string | null,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  resource_attributes: string,
  resource_dropped_attributes?: number,
  resource_schema_url?: string,
  scope_name?: string | null,
  scope_version?: string | null,
  scope_attributes?: string,
  scope_dropped_attributes?: number,
  scope_schema_url?: string,
  attributes?: string,
  dropped_attributes?: number,
  dropped_events?: number,
  dropped_links?: number,
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
  version: number | string,
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
      wait_for_async_insert: 1,
      // With a token, a retry must deduplicate dependent trace-root/service
      // materialized views as well as the source span table — and the insert
      // must be synchronous, because ClickHouse rejects the MV-dedup flag in
      // combination with async_insert (so the flag must not be set on the
      // tokenless async path either; token-less inserts have no retry
      // deduplication to extend into the MVs anyway).
      ...options?.deduplicationToken == null
        ? { async_insert: 1 }
        : {
          async_insert: 0,
          deduplicate_blocks_in_dependent_materialized_views: 1,
          insert_deduplication_token: options.deduplicationToken,
        },
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
  linked_trace_state?: string | null,
  linked_trace_flags?: number,
  attributes?: string,
  dropped_attributes?: number,
};

export async function insertSpanLinks(
  client: ClickHouseClient,
  rows: SpanLinkInsertRow[],
  options?: { deduplicationToken?: string },
): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({
    table: "analytics_internal.span_links",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      wait_for_async_insert: 1,
      // See insertSpans: the MV-dedup flag is only valid (and only useful)
      // together with a synchronous tokened insert.
      ...options?.deduplicationToken == null
        ? { async_insert: 1 }
        : {
          async_insert: 0,
          deduplicate_blocks_in_dependent_materialized_views: 1,
          insert_deduplication_token: options.deduplicationToken,
        },
    },
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
    status_code: "unset" as const,
    status_message: null,
    scope_name: null,
    scope_version: null,
    ...buildTelemetryResourceFields(opts.resource),
    producer: "sdk" as const,
    billing_item: null,
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
