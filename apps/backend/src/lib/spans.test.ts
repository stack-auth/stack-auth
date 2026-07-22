import { describe, expect, it, vi } from "vitest";
import { SPAN_ID_PREFIXES, buildBatchSpanRows, buildEventSpanFields, insertSessionReplaySpans, monotoneEndSpanVersion, toSessionReplaySegmentSpanId, toSpanId, wireSpanIdPrefix } from "./spans";

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

describe("wireSpanIdPrefix", () => {
  it("routes $page-view to pv-, other client system types to sas-, and custom names to cs-", () => {
    expect(wireSpanIdPrefix("$page-view")).toBe("pv-");
    expect(wireSpanIdPrefix("$away")).toBe("sas-");
    expect(wireSpanIdPrefix("$offline")).toBe("sas-");
    expect(wireSpanIdPrefix("checkout-flow")).toBe("cs-");
  });

  it("asserts on $ types that are not client-writable (server-derived or unknown)", () => {
    expect(() => wireSpanIdPrefix("$session-replay")).toThrowError(/not a writable system span type/);
    expect(() => wireSpanIdPrefix("$refresh-token")).toThrowError(/not a writable system span type/);
    expect(() => wireSpanIdPrefix("$made-up")).toThrowError(/not a writable system span type/);
  });
});

describe("buildBatchSpanRows", () => {
  const NOW_MS = new Date("2026-01-01T00:10:00.000Z").getTime();
  const baseOpts = {
    projectId: "p1",
    branchId: "b1",
    userId: "user1",
    refreshTokenId: "rt1",
    sessionReplayId: "replay1",
    sessionReplaySegmentId: "seg1",
    serverNowMs: NOW_MS,
  };
  const baseSpan = {
    span_id: "0f000000-0000-4000-8000-000000000001",
    span_type: "checkout-flow",
    started_at_ms: NOW_MS - 60_000,
    ended_at_ms: null,
    parent_span_ids: [] as string[],
    data: {},
    updated_at_ms: NOW_MS - 60_000,
  };

  it("prefixes the span id and every client parent with cs- and prepends the full system ancestry root-first", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{
        ...baseSpan,
        parent_span_ids: ["0f000000-0000-4000-8000-00000000aaaa", "0f000000-0000-4000-8000-00000000bbbb"],
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`cs-${baseSpan.span_id}`);
    expect(rows[0].parent_span_ids).toEqual([
      "rti-rt1",
      "sri-replay1",
      "srsi-replay1:seg1",
      "cs-0f000000-0000-4000-8000-00000000aaaa",
      "cs-0f000000-0000-4000-8000-00000000bbbb",
    ]);
  });

  it("degrades the system ancestry with the same gating as event rows (refresh-token only, then none)", () => {
    const refreshTokenOnly = buildBatchSpanRows({
      ...baseOpts,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      spans: [baseSpan],
    });
    expect(refreshTokenOnly[0].parent_span_ids).toEqual(["rti-rt1"]);

    const serverAuth = buildBatchSpanRows({
      ...baseOpts,
      userId: null,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      spans: [baseSpan],
    });
    expect(serverAuth[0].parent_span_ids).toEqual([]);
    expect(serverAuth[0].user_id).toBeNull();
    expect(serverAuth[0].refresh_token_id).toBeNull();
  });

  it("keeps open intervals open and fills identity columns raw (unprefixed)", () => {
    const rows = buildBatchSpanRows({ ...baseOpts, spans: [baseSpan] });
    expect(rows[0]).toMatchObject({
      span_type: "checkout-flow",
      span_ended_at: null,
      project_id: "p1",
      branch_id: "b1",
      user_id: "user1",
      team_id: null,
      refresh_token_id: "rt1",
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
    });
    expect(rows[0].span_started_at).toEqual(new Date(baseSpan.started_at_ms));
  });

  it("uses the client updated_at_ms as the version, clamped to [1, now + 5min]", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, updated_at_ms: NOW_MS - 1_000 },
        { ...baseSpan, span_id: "0f000000-0000-4000-8000-000000000002", updated_at_ms: 0 },
        { ...baseSpan, span_id: "0f000000-0000-4000-8000-000000000003", updated_at_ms: NOW_MS + 60 * 60 * 1000 },
      ],
    });
    expect(rows[0].version).toBe(NOW_MS - 1_000);
    expect(rows[1].version).toBe(1);
    expect(rows[2].version).toBe(NOW_MS + 5 * 60 * 1000);
  });

  it("serializes data to a JSON string and strips lone surrogates (ClickHouse rejects them)", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, data: { label: "truncated \uD83D", count: 3 } }],
    });
    expect(rows[0].data).toBe(JSON.stringify({ label: "truncated �", count: 3 }));
  });

  it("closes the interval when ended_at_ms is set", () => {
    const endedAtMs = NOW_MS - 30_000;
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, ended_at_ms: endedAtMs, updated_at_ms: endedAtMs }],
    });
    expect(rows[0].span_ended_at).toEqual(new Date(endedAtMs));
    expect(rows[0].version).toBe(endedAtMs);
  });

  it("refuses non-client-writable $-prefixed span types even if a caller bypasses the route schema", () => {
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$session-replay" }],
    })).toThrowError(/not a writable system span type/);
  });

  it("prefixes a $page-view span id with pv- and other system autocapture spans with sas-", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, span_type: "$page-view" },
        { ...baseSpan, span_id: "0f000000-0000-4000-8000-000000000002", span_type: "$away" },
      ],
    });
    expect(rows[0].id).toBe(`pv-${baseSpan.span_id}`);
    expect(rows[0].span_type).toBe("$page-view");
    expect(rows[1].id).toBe("sas-0f000000-0000-4000-8000-000000000002");
    expect(rows[1].span_type).toBe("$away");
  });

  it("inserts the pv- ancestor between the system ancestry and the custom chain", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{
        ...baseSpan,
        page_view_span_id: "0f000000-0000-4000-8000-00000000cccc",
        parent_span_ids: ["0f000000-0000-4000-8000-00000000aaaa"],
      }],
    });
    expect(rows[0].parent_span_ids).toEqual([
      "rti-rt1",
      "sri-replay1",
      "srsi-replay1:seg1",
      "pv-0f000000-0000-4000-8000-00000000cccc",
      "cs-0f000000-0000-4000-8000-00000000aaaa",
    ]);
  });

  it("refuses a $page-view span that carries page or custom ancestry, and a span naming itself as its page", () => {
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$page-view", page_view_span_id: "0f000000-0000-4000-8000-00000000cccc" }],
    })).toThrowError(/must not itself carry page_view_span_id or parent_span_ids/);
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$page-view", parent_span_ids: ["0f000000-0000-4000-8000-00000000aaaa"] }],
    })).toThrowError(/must not itself carry page_view_span_id or parent_span_ids/);
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$away", page_view_span_id: baseSpan.span_id }],
    })).toThrowError(/must not name itself/);
  });
});
