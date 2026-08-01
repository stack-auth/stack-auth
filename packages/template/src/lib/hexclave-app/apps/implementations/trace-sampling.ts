import type { SpanUpdateRow } from "./telemetry-core";

/**
 * The small wire-shape subset trace sampling needs from events. Keeping this
 * structural prevents the sampler from depending on either environment's
 * batching implementation.
 */
export type TraceSamplingEvent = {
  event_type: string,
  trace_id?: string,
  level?: string,
  data: Record<string, unknown>,
};

const TRACE_ID_BUCKET_COUNT = 0x1_0000_0000;
export const TRACE_SAMPLING_SLOW_SPAN_MS = 3_000;

/**
 * Deterministic head decision shared by propagation and both flushers.
 *
 * W3C trace ids are uniformly random, so their first 32 bits form a stable
 * bucket. Every process that sees the same trace id therefore reaches the same
 * decision without shared state, and repeated upserts of one trace cannot
 * drift between kept and dropped batches.
 */
export function isTraceSampled(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  const bucket = Number.parseInt(traceId.slice(0, 8), 16);
  return bucket < Math.floor(sampleRate * TRACE_ID_BUCKET_COUNT);
}

function isPresentErrorMarker(value: unknown): boolean {
  return value !== undefined
    && value !== null
    && value !== false
    && value !== 0
    && value !== "";
}

function isFailedStatus(value: unknown): boolean {
  if (typeof value === "number") return value >= 400;
  return typeof value === "string" && value.toLowerCase() === "error";
}

export function shouldPromoteSpan(row: SpanUpdateRow): boolean {
  if (isPresentErrorMarker(row.data.error)) return true;
  if (isFailedStatus(row.data.status) || isFailedStatus(row.data.status_code)) return true;
  return row.ended_at_ms !== null
    && row.ended_at_ms - row.started_at_ms >= TRACE_SAMPLING_SLOW_SPAN_MS;
}

export function shouldPromoteEvent(event: TraceSamplingEvent): boolean {
  if (event.event_type === "$error") return true;
  if (event.event_type === "$log" && event.level?.toLowerCase() === "error") return true;
  return isPresentErrorMarker(event.data.error);
}

/**
 * Returns the traces that one flush must retain. Sampling happens on the
 * complete coalesced flush snapshot, not inside individual producers:
 *
 * - a deterministic head decision keeps ordinary healthy traces;
 * - any failure/slow signal promotes every event and span from that trace in
 *   this snapshot;
 * - untraced events are outside trace sampling and are always retained by the
 *   caller.
 */
export function getKeptTraceIds(
  events: readonly TraceSamplingEvent[],
  spans: readonly SpanUpdateRow[],
  sampleRate: number,
): Set<string> {
  const traceIds = new Set<string>();
  const promotedTraceIds = new Set<string>();

  for (const event of events) {
    if (event.trace_id === undefined) continue;
    traceIds.add(event.trace_id);
    if (shouldPromoteEvent(event)) promotedTraceIds.add(event.trace_id);
  }
  for (const span of spans) {
    traceIds.add(span.trace_id);
    if (shouldPromoteSpan(span)) promotedTraceIds.add(span.trace_id);
  }

  const keptTraceIds = new Set<string>();
  for (const traceId of traceIds) {
    if (promotedTraceIds.has(traceId) || isTraceSampled(traceId, sampleRate)) {
      keptTraceIds.add(traceId);
    }
  }
  return keptTraceIds;
}
