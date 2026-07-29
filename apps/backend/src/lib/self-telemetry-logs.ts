import type { LogLevel } from "@hexclave/shared/dist/utils/analytics-wire";
import type { AnalyticsIngestContext, TelemetryProducer } from "./self-telemetry-spans";
import { getSharedClickhouseAdminClient } from "./clickhouse";

/**
 * One `$log` row of `analytics_internal.logs` as produced by the backend's
 * self-instrumentation log exporter (`self-telemetry-log-exporter.ts`) — the
 * direct, OTel-free intermediate representation between the in-process logs
 * pipeline and ClickHouse. SDK-sent `$log` events take the events/batch route
 * instead, which builds its insert rows inline (they additionally carry the
 * session-derived ancestry and a `runtime` stamp).
 */
export type AnalyticsLogRow = {
  event_type: string,
  event_at: Date,
  /** Human-readable log text (capped at TELEMETRY_MAX_LOG_MESSAGE_BYTES by the producer). */
  message: string,
  level: LogLevel,
  /** Structured attributes riding alongside the message. */
  data: Record<string, unknown>,
  parent_span_ids: string[],
  trace_id: string | null,
  span_id: string | null,
  producer: TelemetryProducer,
  service_namespace: string | null,
  service_name: string | null,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  resource_attributes: string,
};

// Exported so self-telemetry-logs.test.ts can assert the produced key set against
// EVENTS_COLUMNS from scripts/clickhouse-migrations.ts — see the equivalent
// note in self-telemetry-spans.ts.
export function buildLogInsertRows(logs: AnalyticsLogRow[], context: AnalyticsIngestContext) {
  return logs.map((log) => ({
    ...log,
    project_id: context.projectId,
    branch_id: context.branchId,
    user_id: context.userId ?? null,
    team_id: null,
    refresh_token_id: context.refreshTokenId ?? null,
    session_replay_id: context.sessionReplayId ?? null,
    session_replay_segment_id: context.sessionReplaySegmentId ?? null,
  }));
}

export async function insertAnalyticsLogs(options: {
  logs: AnalyticsLogRow[],
} & AnalyticsIngestContext): Promise<void> {
  if (options.logs.length === 0) return;
  // Shared (never-closed) client: this runs on the telemetry export hot path,
  // where a per-call connection pool would cost a TCP handshake per batch.
  const client = getSharedClickhouseAdminClient();
  await client.insert({
    table: "analytics_internal.logs",
    values: buildLogInsertRows(options.logs, options),
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
}
