import { describe, expect, it } from "vitest";
import type { SpanUpdateRow } from "./telemetry-core";
import { getKeptTraceIds, isTraceSampled, shouldPromoteEvent, shouldPromoteSpan } from "./trace-sampling";

const KEPT_TRACE_ID = "00000000111111111111111111111111";
const DROPPED_TRACE_ID = "ffffffff111111111111111111111111";

function span(overrides: Partial<SpanUpdateRow> = {}): SpanUpdateRow {
  return {
    trace_id: DROPPED_TRACE_ID,
    span_id: "1111111111111111",
    parent_span_id: null,
    span_type: "request",
    started_at_ms: 1_000,
    ended_at_ms: 1_100,
    data: {},
    updated_at_ms: 1_100,
    ...overrides,
  };
}

describe("trace sampling", () => {
  it("makes one deterministic decision from the trace id", () => {
    expect(isTraceSampled(KEPT_TRACE_ID, 0.1)).toBe(true);
    expect(isTraceSampled(DROPPED_TRACE_ID, 0.1)).toBe(false);
    expect(isTraceSampled(DROPPED_TRACE_ID, 1)).toBe(true);
    expect(isTraceSampled(KEPT_TRACE_ID, 0)).toBe(false);
  });

  it("recognizes every trace-promoting span, log, and event signal", () => {
    expect(shouldPromoteSpan(span({ data: { status: 500 } }))).toBe(true);
    expect(shouldPromoteSpan(span({ data: { status_code: "error" } }))).toBe(true);
    expect(shouldPromoteSpan(span({ data: { error: "database unavailable" } }))).toBe(true);
    expect(shouldPromoteSpan(span({ ended_at_ms: 4_000 }))).toBe(true);
    expect(shouldPromoteSpan(span({ data: { status: 200 } }))).toBe(false);
    expect(shouldPromoteEvent({ event_type: "$error", trace_id: DROPPED_TRACE_ID, data: {} })).toBe(true);
    expect(shouldPromoteEvent({ event_type: "$log", trace_id: DROPPED_TRACE_ID, level: "error", data: {} })).toBe(true);
    expect(shouldPromoteEvent({ event_type: "$log", trace_id: DROPPED_TRACE_ID, level: "ERROR", data: {} })).toBe(true);
    expect(shouldPromoteEvent({ event_type: "checkout.failed", trace_id: DROPPED_TRACE_ID, data: { error: true } })).toBe(true);
    expect(shouldPromoteEvent({ event_type: "$log", trace_id: DROPPED_TRACE_ID, level: "warn", data: {} })).toBe(false);
  });

  it.each([
    {
      name: "failed child span",
      events: [],
      spans: [
        span({
          span_id: "3333333333333333",
          parent_span_id: "2222222222222222",
          data: { status_code: "error" },
        }),
      ],
    },
    {
      name: "$error event",
      events: [{ event_type: "$error", trace_id: DROPPED_TRACE_ID, data: {} }],
      spans: [],
    },
    {
      name: "error-level $log",
      events: [{ event_type: "$log", trace_id: DROPPED_TRACE_ID, level: "error", data: {} }],
      spans: [],
    },
    {
      name: "custom event carrying an error",
      events: [{ event_type: "checkout.failed", trace_id: DROPPED_TRACE_ID, data: { error: "declined" } }],
      spans: [],
    },
  ])("promotes the complete trace group for a $name", ({ events, spans }) => {
    const healthyParent = span({
      span_id: "2222222222222222",
      ended_at_ms: null,
    });

    expect([...getKeptTraceIds(events, [healthyParent, ...spans], 0)]).toEqual([DROPPED_TRACE_ID]);
    expect(getKeptTraceIds([], [healthyParent], 0).size).toBe(0);
  });
});
