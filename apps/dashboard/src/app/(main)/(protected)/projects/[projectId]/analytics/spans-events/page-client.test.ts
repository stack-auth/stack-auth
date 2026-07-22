import { describe, expect, it } from "vitest";
import { collectRefreshTokenParentIds, parseEventRow, parseUniqueSpanRows } from "./page-client";

describe("analytics trace row parsing", () => {
  it("normalizes serialized event data for the shared detail dialog", () => {
    expect(parseEventRow({
      event_type: "checkout",
      event_at: "2026-07-21 12:00:00.000",
      parent_span_ids: ["rti-session", 42],
      data: "{\"step\":2}",
    })).toMatchObject({
      eventType: "checkout",
      parentSpanIds: ["rti-session"],
      raw: { data: { step: 2 } },
    });
  });

  it("collects only unique refresh-token parents referenced by visible rows", () => {
    expect(collectRefreshTokenParentIds([
      { parent_span_ids: ["rti-old", "cs-child"] },
      { parent_span_ids: ["rti-old", "rti-other"] },
      { parent_span_ids: null },
    ])).toEqual(["rti-old", "rti-other"]);
  });

  it("deduplicates a refresh-token parent returned by both span queries", () => {
    const row = {
      id: "rti-old",
      span_type: "$refresh-token",
      span_started_at: "2026-07-21 12:00:00.000",
      span_ended_at: null,
      parent_span_ids: [],
      data: "{}",
    };
    expect(parseUniqueSpanRows([row, row])).toHaveLength(1);
  });
});
