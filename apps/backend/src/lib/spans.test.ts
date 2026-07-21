import { describe, expect, it, vi } from "vitest";
import { SPAN_ID_PREFIXES, buildEventSpanFields, insertSessionReplaySpans, monotoneEndSpanVersion, toSessionReplaySegmentSpanId, toSpanId } from "./spans";

describe("toSpanId", () => {
  it("prefixes raw ids without touching the raw value", () => {
    expect(toSpanId(SPAN_ID_PREFIXES.sessionReplay, "abc")).toBe("sri-abc");
    expect(toSpanId(SPAN_ID_PREFIXES.sessionReplaySegment, "seg")).toBe("srsi-seg");
    expect(toSpanId(SPAN_ID_PREFIXES.refreshToken, "rt1")).toBe("rti-rt1");
  });

  it("only accepts known prefixes (compile-time constraint)", () => {
    // @ts-expect-error — arbitrary strings are not valid span id prefixes
    toSpanId("xx-", "abc");
    // @ts-expect-error — an already-prefixed value is not a valid prefix
    toSpanId("sri-abc", "def");
  });
});

describe("monotoneEndSpanVersion", () => {
  it("is the span end as epoch ms, so later ends always win the ReplacingMergeTree", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-01-01T00:05:00.000Z");
    expect(monotoneEndSpanVersion(later)).toBeGreaterThan(monotoneEndSpanVersion(earlier));
    expect(monotoneEndSpanVersion(earlier)).toBe(earlier.getTime());
  });
});

describe("toSessionReplaySegmentSpanId", () => {
  it("scopes the stable per-tab segment id to its replay", () => {
    expect(toSessionReplaySegmentSpanId("replay-a", "same-tab")).toBe("srsi-replay-a:same-tab");
    expect(toSessionReplaySegmentSpanId("replay-a", "same-tab")).not.toBe(
      toSessionReplaySegmentSpanId("replay-b", "same-tab"),
    );
  });
});

describe("buildEventSpanFields", () => {
  it("lists all known ancestors root-first: refresh-token, replay, segment", () => {
    expect(buildEventSpanFields({ sessionReplayId: "s1", sessionReplaySegmentId: "seg1", refreshTokenId: "r1" })).toEqual({
      parent_span_ids: ["rti-r1", "sri-s1", "srsi-s1:seg1"],
    });
  });

  it("omits the segment parent when there is no replay (segment spans only exist under a replay)", () => {
    expect(buildEventSpanFields({ sessionReplayId: null, sessionReplaySegmentId: "seg1", refreshTokenId: "r1" })).toEqual({
      parent_span_ids: ["rti-r1"],
    });
  });

  it("includes refresh-token and replay when there is a replay but no segment", () => {
    expect(buildEventSpanFields({ sessionReplayId: "s1", refreshTokenId: "r1" })).toEqual({
      parent_span_ids: ["rti-r1", "sri-s1"],
    });
  });

  it("emits an empty parent list when nothing is known", () => {
    expect(buildEventSpanFields({})).toEqual({ parent_span_ids: [] });
  });
});

describe("insertSessionReplaySpans", () => {
  it("emits a replay span and a segment span in one insert with the right ids and parents", async () => {
    const captured: any[] = [];
    const client = {
      insert: vi.fn(async (args: any) => {
        captured.push(args);
      }),
    } as any;

    const replayStartedAt = new Date("2026-01-01T00:00:00.000Z");
    const replayLastEventAt = new Date("2026-01-01T00:05:00.000Z");
    const segmentStartedAt = new Date("2026-01-01T00:01:00.000Z");
    const segmentLastEventAt = new Date("2026-01-01T00:04:00.000Z");

    await insertSessionReplaySpans(client, {
      projectId: "p1",
      branchId: "b1",
      replayId: "replay1",
      sessionReplaySegmentId: "seg1",
      projectUserId: "user1",
      refreshTokenId: "rt1",
      replayStartedAt,
      replayLastEventAt,
      segmentStartedAt,
      segmentLastEventAt,
    });

    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(captured[0].table).toBe("analytics_internal.spans");
    const rows = captured[0].values;
    expect(rows).toHaveLength(2);

    const [replaySpan, segmentSpan] = rows;

    expect(replaySpan).toMatchObject({
      id: "sri-replay1",
      span_type: "$session-replay",
      parent_span_ids: ["rti-rt1"],
      project_id: "p1",
      branch_id: "b1",
      user_id: "user1",
      refresh_token_id: "rt1",
      session_replay_id: "replay1",
      session_replay_segment_id: null,
      // version is the span's own end (epoch ms) so the latest-end row wins in the
      // ReplacingMergeTree regardless of insert order.
      version: replayLastEventAt.getTime(),
    });
    expect(replaySpan.span_started_at).toBe(replayStartedAt);
    expect(replaySpan.span_ended_at).toBe(replayLastEventAt);

    expect(segmentSpan).toMatchObject({
      id: "srsi-replay1:seg1",
      span_type: "$session-replay-segment",
      parent_span_ids: ["rti-rt1", "sri-replay1"],
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
      version: segmentLastEventAt.getTime(),
    });
    expect(segmentSpan.span_started_at).toBe(segmentStartedAt);
    expect(segmentSpan.span_ended_at).toBe(segmentLastEventAt);
  });

  it("does not call insert when given an empty row list (insertSpans guard)", async () => {
    const client = { insert: vi.fn() } as any;
    const { insertSpans } = await import("./spans");
    await insertSpans(client, []);
    expect(client.insert).not.toHaveBeenCalled();
  });
});
