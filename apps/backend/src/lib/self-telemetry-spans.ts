import { getSharedClickhouseAdminClient } from "./clickhouse";

/** Who wrote a telemetry row. 'sdk' rows are the customer's own telemetry (and
 * the only billable spans — see span_writes_mv in scripts/clickhouse-migrations.ts);
 * 'hexclave-backend' rows come from the backend's self-instrumentation and are
 * always free. */
export type TelemetryProducer = "sdk" | "hexclave-backend";

export type AnalyticsIngestContext = {
  projectId: string,
  branchId: string,
  userId?: string | null,
  refreshTokenId?: string | null,
  sessionReplayId?: string | null,
  sessionReplaySegmentId?: string | null,
};

/**
 * One row of `analytics_internal.spans` as produced by the backend's
 * self-instrumentation exporter (`self-telemetry-span-exporter.ts`) — the direct,
 * OTel-free intermediate representation between the in-process tracer and
 * ClickHouse. SDK-sent wire spans take the separate `spans.tsx` path
 * (`SpanInsertRow`), which composes Hexclave's typed-id ancestry; this shape
 * mirrors the slimmed ClickHouse columns 1:1 plus the `events`/`links`
 * sub-rows that fan out into the events/span_links tables at insert time.
 */
export type AnalyticsSpanRow = {
  trace_id: string,
  span_id: string,
  span_type: string,
  started_at: Date,
  ended_at: Date,
  /** Root-first ancestry path; in-batch ancestors are expanded by the exporter. */
  parent_span_ids: string[],
  kind: string,
  status_code: string,
  status_message: string | null,
  service_namespace: string | null,
  service_name: string | null,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  /** JSON-encoded environment metadata that has no dedicated column. */
  resource_attributes: string,
  scope_name: string | null,
  scope_version: string | null,
  /** JSON-encoded span payload. */
  data: string,
  producer: TelemetryProducer,
  events: AnalyticsSpanRowEvent[],
  links: AnalyticsSpanRowLink[],
  version: number,
};

export type AnalyticsSpanRowEvent = {
  name: string,
  at: Date,
  data: Record<string, unknown>,
};

export type AnalyticsSpanRowLink = {
  linked_trace_id: string,
  linked_span_id: string,
  attributes: string,
};

// The row builders below hand-list ClickHouse column keys. They are exported
// (rather than inlined into the insert function) so self-telemetry-spans.test.ts can
// assert — at compile time via the *ColumnName unions exported from
// scripts/clickhouse-migrations.ts, and at runtime via Object.keys — that these
// key sets stay in lockstep with the table declarations. Doing the check in the
// test keeps this hot-path module free of any (even type-only) dependency on
// the migrations script.

export function buildSpanInsertRows(spans: AnalyticsSpanRow[], context: AnalyticsIngestContext) {
  return spans.map((span) => {
    const { events: _events, links: _links, ...spanRow } = span;
    return {
      ...spanRow,
      project_id: context.projectId,
      branch_id: context.branchId,
      user_id: context.userId ?? null,
      team_id: null,
      refresh_token_id: context.refreshTokenId ?? null,
      session_replay_id: context.sessionReplayId ?? null,
      session_replay_segment_id: context.sessionReplaySegmentId ?? null,
    };
  });
}

export function buildSpanEventInsertRows(spans: AnalyticsSpanRow[], context: AnalyticsIngestContext) {
  return spans.flatMap((span) => span.events.map((event) => ({
    event_type: event.name,
    event_at: event.at,
    data: event.data,
    // Span milestones inherit their span's producer so the events table stays
    // honest about who wrote the row (today always 'hexclave-backend' — SDK
    // wire spans carry no sub-events).
    producer: span.producer,
    project_id: context.projectId,
    branch_id: context.branchId,
    user_id: context.userId ?? null,
    team_id: null,
    refresh_token_id: context.refreshTokenId ?? null,
    session_replay_id: context.sessionReplayId ?? null,
    session_replay_segment_id: context.sessionReplaySegmentId ?? null,
    parent_span_ids: [...span.parent_span_ids, span.span_id],
    trace_id: span.trace_id,
    span_id: span.span_id,
    service_namespace: span.service_namespace,
    service_name: span.service_name,
    service_version: span.service_version,
    service_instance_id: span.service_instance_id,
    deployment_environment_name: span.deployment_environment_name,
    resource_attributes: span.resource_attributes,
  })));
}

export function buildSpanLinkInsertRows(spans: AnalyticsSpanRow[], context: AnalyticsIngestContext) {
  return spans.flatMap((span) => span.links.map((link) => ({
    project_id: context.projectId,
    branch_id: context.branchId,
    trace_id: span.trace_id,
    owner_span_id: span.span_id,
    ...link,
  })));
}

export async function insertAnalyticsSpans(options: {
  spans: AnalyticsSpanRow[],
} & AnalyticsIngestContext): Promise<void> {
  if (options.spans.length === 0) return;
  // Shared (never-closed) client: this runs on the telemetry export hot path,
  // where a per-call connection pool would cost a TCP handshake per batch.
  const client = getSharedClickhouseAdminClient();
  const spanRows = buildSpanInsertRows(options.spans, options);
  const eventRows = buildSpanEventInsertRows(options.spans, options);
  const linkRows = buildSpanLinkInsertRows(options.spans, options);

  await client.insert({
    table: "analytics_internal.spans",
    values: spanRows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
  if (eventRows.length > 0) {
    // Span milestone events are best-effort under at-least-once export
    // retries: unlike the spans table (ReplacingMergeTree keyed by span
    // identity) and span_links (ReplacingMergeTree keyed by full link
    // identity), event rows carry no natural identity key in the events table,
    // so a retried export inserts them twice and both copies stay. A
    // dedup/version scheme for span events is a deliberate follow-up.
    await client.insert({
      table: "analytics_internal.span_events",
      values: eventRows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }
  if (linkRows.length > 0) {
    await client.insert({
      table: "analytics_internal.span_links",
      values: linkRows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }
}
