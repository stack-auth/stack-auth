import { getClickhouseAdminClient } from "./clickhouse";
import type { NormalizedOtlpSpan } from "./otlp";

export async function insertAnalyticsSpans(options: {
  spans: NormalizedOtlpSpan[],
  projectId: string,
  branchId: string,
  userId?: string | null,
  refreshTokenId?: string | null,
  sessionReplayId?: string | null,
  sessionReplaySegmentId?: string | null,
}): Promise<void> {
  if (options.spans.length === 0) return;
  const client = getClickhouseAdminClient();
  try {
    const spanRows = options.spans.map((span) => {
      const { events: _events, links: _links, ...spanRow } = span;
      return {
        ...spanRow,
        project_id: options.projectId,
        branch_id: options.branchId,
        user_id: options.userId ?? null,
        team_id: null,
        refresh_token_id: options.refreshTokenId ?? null,
        session_replay_id: options.sessionReplayId ?? null,
        session_replay_segment_id: options.sessionReplaySegmentId ?? null,
      };
    });
    const eventRows = options.spans.flatMap((span) => span.events.map((event) => ({
      event_type: event.name,
      event_at: event.at,
      data: event.attributes,
      project_id: options.projectId,
      branch_id: options.branchId,
      user_id: options.userId ?? null,
      team_id: null,
      refresh_token_id: options.refreshTokenId ?? null,
      session_replay_id: options.sessionReplayId ?? null,
      session_replay_segment_id: options.sessionReplaySegmentId ?? null,
      parent_span_ids: [...span.parent_span_ids, span.span_id],
      trace_id: span.trace_id,
      source: "otel-span-event",
      service_namespace: span.service_namespace,
      service_name: span.service_name,
      service_version: span.service_version,
      service_instance_id: span.service_instance_id,
      deployment_environment_name: span.deployment_environment_name,
      resource_attributes: span.resource_attributes,
      resource_schema_url: span.resource_schema_url,
      scope_name: span.scope_name,
      scope_version: span.scope_version,
      scope_attributes: span.scope_attributes,
      scope_schema_url: span.scope_schema_url,
      dropped_attributes: event.dropped_attributes,
    })));
    const linkRows = options.spans.flatMap((span) => span.links.map((link) => ({
      project_id: options.projectId,
      branch_id: options.branchId,
      trace_id: span.trace_id,
      owner_span_id: span.span_id,
      ...link,
    })));

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
      await client.insert({
        table: "analytics_internal.events",
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
  } finally {
    await client.close();
  }
}
