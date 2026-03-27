export type AnalyticsQueryOptions = {
  query: string,
  params?: Record<string, unknown>,
  timeout_ms?: number,
  include_all_branches?: boolean,
};

export type AnalyticsQueryResponse = {
  result: Record<string, unknown>[],
  query_id: string,
};

export type AnalyticsEventPayload = Record<string, unknown>;

export type AnalyticsBatchEvent = {
  event_type: string,
  event_id?: string,
  trace_id?: string,
  event_at_ms: number,
  parent_span_ids?: string[],
  data: AnalyticsEventPayload,
  user_id?: string,
  team_id?: string,
  session_replay_id?: string,
  session_replay_segment_id?: string,
};

export type AnalyticsBatchSpan = {
  span_type: string,
  span_id: string,
  trace_id?: string,
  started_at_ms: number,
  ended_at_ms?: number | null,
  parent_ids?: string[],
  data: AnalyticsEventPayload,
  user_id?: string,
  team_id?: string,
  session_replay_id?: string,
  session_replay_segment_id?: string,
};

/**
 * Auto-captured (Stack-managed) analytics event types that browser clients are
 * allowed to send. These are the only `$`-prefixed event types permitted from
 * client auth. Server-only types like `$request` are validated separately on
 * the backend.
 *
 * Span types have no public `$`-prefixed types — all `$`-prefixed spans
 * ($session-replay, $session-replay-segment) are created server-side only.
 */
export const AUTO_CAPTURED_ANALYTICS_EVENT_TYPES = [
  "$page-view",
  "$click",
  "$tab-in",
  "$tab-out",
  "$window-focus",
  "$window-blur",
  "$submit",
  "$scroll-depth",
  "$rage-click",
  "$copy",
  "$paste",
  "$error",
] as const;
export type AutoCapturedAnalyticsEventType = typeof AUTO_CAPTURED_ANALYTICS_EVENT_TYPES[number];

export type AnalyticsReplayLinkFields = Pick<AnalyticsBatchEvent, 'session_replay_id' | 'session_replay_segment_id'>;

export type AnalyticsEventBatchRequest = AnalyticsReplayLinkFields & {
  batch_id: string,
  sent_at_ms: number,
  events: AnalyticsBatchEvent[],
};

export type AnalyticsSpanBatchRequest = {
  batch_id: string,
  sent_at_ms: number,
  spans: AnalyticsBatchSpan[],
};
