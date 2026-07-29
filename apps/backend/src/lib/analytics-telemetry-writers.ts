import { classifyTelemetrySignal, type LogLevel, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { buildEventSpanFields, toSpanId, SPAN_ID_PREFIXES } from "./spans";
import { buildTelemetryResourceFields } from "./telemetry-resource";

export type BatchEventWireItem = {
  event_type: string,
  event_at_ms: number,
  data: unknown,
  parent_span_ids?: string[],
  page_view_span_id?: string,
  http_client_span_id?: string,
  message?: string,
  level?: LogLevel,
};

export type BatchSignalContext = {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  runtime: "browser" | "server",
  resource: TelemetryResource,
};

export function getEventStorageTable(eventType: string): "analytics_internal.events" | "analytics_internal.logs" {
  return classifyTelemetrySignal(eventType, "event").lens === "analytics"
    ? "analytics_internal.events"
    : "analytics_internal.logs";
}

export function getBatchDestinationDeduplicationToken(
  batchId: string,
  table: "analytics_internal.events" | "analytics_internal.logs" | "analytics_internal.spans",
): string {
  return `${batchId}:${table}`;
}

/**
 * Protocol-neutral normalized event batch. The current native SDK wire
 * normalizer produces this shape; a future standards-complete OTLP normalizer
 * can target the same boundary without adding another ingestion/storage path.
 */
export type NormalizedEventBatch = {
  productEvents: ReturnType<typeof buildEventRows>,
  logOccurrences: ReturnType<typeof buildEventRows>,
};

function buildEventRows(events: BatchEventWireItem[], context: BatchSignalContext) {
  const eventSpanFields = buildEventSpanFields({
    sessionReplayId: context.sessionReplayId,
    sessionReplaySegmentId: context.sessionReplaySegmentId,
    refreshTokenId: context.refreshTokenId,
  });

  return events.map((event) => {
    const parentSpanIds = [
      ...eventSpanFields.parent_span_ids,
      ...event.page_view_span_id != null ? [toSpanId(SPAN_ID_PREFIXES.pageView, event.page_view_span_id)] : [],
      ...(event.parent_span_ids ?? []).map((id) => toSpanId(SPAN_ID_PREFIXES.custom, id)),
      ...event.http_client_span_id != null ? [toSpanId(SPAN_ID_PREFIXES.httpClient, event.http_client_span_id)] : [],
    ];
    return {
      event_type: event.event_type,
      event_at: new Date(event.event_at_ms),
      data: stripLoneSurrogates(event.data),
      producer: "sdk",
      runtime: context.runtime,
      ...buildTelemetryResourceFields(context.resource),
      project_id: context.projectId,
      branch_id: context.branchId,
      user_id: context.userId,
      team_id: null,
      refresh_token_id: context.refreshTokenId,
      session_replay_id: context.sessionReplayId,
      session_replay_segment_id: context.sessionReplaySegmentId,
      parent_span_ids: parentSpanIds,
      trace_id: parentSpanIds[0] ?? null,
      ...event.event_type === "$log" ? {
        message: stripLoneSurrogates(event.message),
        level: event.level,
      } : {},
    };
  });
}

export function normalizeBatchEvents(
  events: BatchEventWireItem[],
  context: BatchSignalContext,
): NormalizedEventBatch {
  const rows = buildEventRows(events, context);
  return {
    productEvents: rows.filter((row) => getEventStorageTable(row.event_type) === "analytics_internal.events"),
    logOccurrences: rows.filter((row) => getEventStorageTable(row.event_type) === "analytics_internal.logs"),
  };
}

/**
 * Dispatches event-shaped telemetry by taxonomy ownership. Product events and
 * code occurrences deliberately share a wire contract, but never a storage
 * table or dashboard read model.
 */
export async function insertBatchEvents(
  clickhouseClient: ClickHouseClient,
  events: BatchEventWireItem[],
  context: BatchSignalContext,
  batchId: string,
): Promise<void> {
  const normalized = normalizeBatchEvents(events, context);

  const insertRows = async (
    table: "analytics_internal.events" | "analytics_internal.logs",
    values: NormalizedEventBatch["productEvents"],
  ) => {
    if (values.length === 0) return;
    await clickhouseClient.insert({
      table,
      values,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        // A mixed wire batch becomes one insert per destination. Stable
        // destination tokens make retries safe when one table committed before
        // another failed. Synchronous inserts preserve dependent-view
        // deduplication on the supported ClickHouse 25.10 baseline.
        async_insert: 0,
        insert_deduplication_token: getBatchDestinationDeduplicationToken(batchId, table),
      },
    });
  };

  await Promise.all([
    insertRows("analytics_internal.events", normalized.productEvents),
    insertRows("analytics_internal.logs", normalized.logOccurrences),
  ]);
}
