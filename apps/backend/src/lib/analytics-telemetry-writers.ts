import { classifyTelemetrySignal, type LogLevel, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { buildTelemetryResourceFields } from "./telemetry-resource";

export type BatchEventWireItem = {
  event_type: string,
  event_at_ms: number,
  data: unknown,
  /**
   * The ENCLOSING span this event happened inside, as W3C identity. Both fields
   * arrive together or not at all: an event is an instant, so unlike a span it has
   * no identity of its own and never roots a trace — an event outside any span
   * simply carries no trace at all, and is correlated by page view and session.
   */
  trace_id?: string,
  span_id?: string,
  /** CORRELATION: which `$page-view` span the event happened on. */
  page_view_span_id?: string,
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
  /**
   * The authenticated SDK ingestion path is always an SDK producer. Platform-
   * synthesized events use separate writers rather than masquerading as input
   * from this batch.
   */
  producer: "sdk",
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
  return events.map((event) => {
    return {
      event_type: event.event_type,
      event_at: new Date(event.event_at_ms),
      data: stripLoneSurrogates(event.data),
      producer: context.producer,
      runtime: context.runtime,
      ...buildTelemetryResourceFields(context.resource),
      project_id: context.projectId,
      branch_id: context.branchId,
      user_id: context.userId,
      team_id: null,
      refresh_token_id: context.refreshTokenId,
      session_replay_id: context.sessionReplayId,
      session_replay_segment_id: context.sessionReplaySegmentId,
      // Stored verbatim: the SDK owns span identity, so there is nothing to
      // compose here any more. `trace_id` is the ENCLOSING span's trace, not a
      // trace this event roots.
      trace_id: event.trace_id ?? null,
      span_id: event.span_id ?? null,
      page_view_span_id: event.page_view_span_id ?? null,
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
