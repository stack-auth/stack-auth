import { describe, expect, it, vi } from "vitest";
import { SPAN_ID_PREFIXES, buildBatchSpanRows, buildEventSpanFields, getBatchParentPathError, insertSessionReplaySpans, monotoneEndSpanVersion, toSessionReplaySegmentSpanId, toSpanId, wireSpanIdPrefix } from "./spans";

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

describe("getBatchParentPathError", () => {
  const makeSpan = (spanId: string, parentSpanIds: string[]) => ({
    span_id: spanId,
    span_type: "test",
    started_at_ms: 1,
    ended_at_ms: null,
    parent_span_ids: parentSpanIds,
    data: {},
    updated_at_ms: 1,
  });

  it("accepts one path and rejects a flattened sibling as event ancestry", () => {
    const root = makeSpan("root", []);
    const left = makeSpan("left", ["root"]);
    const right = makeSpan("right", ["root"]);

    expect(getBatchParentPathError(
      [root, left, right],
      [{ parent_span_ids: ["root", "right"] }],
    )).toBeNull();
    expect(getBatchParentPathError(
      [root, left, right],
      [{ parent_span_ids: ["root", "left", "right"] }],
    )).toMatch(/one ancestry path/);
  });

  it("rejects duplicates and span self-parenting without database reads", () => {
    expect(getBatchParentPathError(
      [makeSpan("self", ["self"])],
      [],
    )).toMatch(/must not include itself/);
    expect(getBatchParentPathError(
      [],
      [{ parent_span_ids: ["same", "same"] }],
    )).toMatch(/must not contain duplicates/);
  });
});

describe("buildEventSpanFields", () => {
  it("lists all known ancestors root-first: refresh-token, replay, segment", () => {
    expect(buildEventSpanFields({ sessionReplayId: "s1", sessionReplaySegmentId: "seg1", refreshTokenId: "r1" })).toEqual({
      parent_span_ids: ["rti-r1", "sri-s1", "srsi-s1:seg1"],
    });
  });

  it("omits the segment parent when there is no replay to scope its identity", () => {
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
      resource: {
        service: { namespace: "commerce", name: "storefront", version: "abc123", instanceId: "iad-1" },
        deploymentEnvironmentName: "preview",
        attributes: { region: "iad1" },
      },
    });

    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(captured[0].table).toBe("analytics_internal.spans");
    expect(captured[0].clickhouse_settings).toMatchObject({
      async_insert: 1,
      wait_for_async_insert: 1,
    });
    const rows = captured[0].values;
    expect(rows).toHaveLength(2);

    const [replaySpan, segmentSpan] = rows;

    expect(replaySpan).toMatchObject({
      trace_id: "rti-rt1",
      span_id: "sri-replay1",
      span_type: "$session-replay",
      parent_span_ids: ["rti-rt1"],
      project_id: "p1",
      branch_id: "b1",
      user_id: "user1",
      refresh_token_id: "rt1",
      session_replay_id: "replay1",
      session_replay_segment_id: null,
      service_namespace: "commerce",
      service_name: "storefront",
      service_version: "abc123",
      service_instance_id: "iad-1",
      deployment_environment_name: "preview",
      resource_attributes: JSON.stringify({ region: "iad1" }),
      // version is the span's own end (epoch ms) so the latest-end row wins in the
      // ReplacingMergeTree regardless of insert order.
      version: replayLastEventAt.getTime(),
    });
    expect(replaySpan.started_at).toBe(replayStartedAt);
    expect(replaySpan.ended_at).toBe(replayLastEventAt);

    expect(segmentSpan).toMatchObject({
      trace_id: "rti-rt1",
      span_id: "srsi-replay1:seg1",
      span_type: "$session-replay-segment",
      parent_span_ids: ["rti-rt1", "sri-replay1"],
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
      version: segmentLastEventAt.getTime(),
    });
    expect(segmentSpan.started_at).toBe(segmentStartedAt);
    expect(segmentSpan.ended_at).toBe(segmentLastEventAt);
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

  it("routes $lib-span into the cs- namespace (wire parent chains are type-blind, so a dedicated prefix would break lib→lib parent linkage)", () => {
    expect(wireSpanIdPrefix("$lib-span")).toBe("cs-");
  });

  it("asserts on $ types that are not wire-writable (backend-derived or unknown)", () => {
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
    resource: {
      service: { namespace: "commerce", name: "storefront", version: "abc123", instanceId: "iad-1" },
      deploymentEnvironmentName: "preview",
      attributes: { region: "iad1" },
    },
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
    expect(rows[0].trace_id).toBe("rti-rt1");
    expect(rows[0].span_id).toBe(`cs-${baseSpan.span_id}`);
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

  it("links nested $lib-span rows: a child's cs-prefixed parent reference matches the parent row's own span_id", () => {
    // Server-auth shape (no session ancestry) — the only way $lib-span rows
    // arrive in practice. The parent lib span ends AFTER the child, so the
    // child's parent reference must resolve purely from the shared cs-
    // namespace, never from batch-local type knowledge.
    const parentLibSpanId = "0f000000-0000-4000-8000-00000000cccc";
    const rows = buildBatchSpanRows({
      ...baseOpts,
      userId: null,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      spans: [
        { ...baseSpan, span_id: parentLibSpanId, span_type: "$lib-span", ended_at_ms: NOW_MS - 1_000 },
        { ...baseSpan, span_type: "$lib-span", ended_at_ms: NOW_MS - 2_000, parent_span_ids: [parentLibSpanId] },
      ],
    });
    expect(rows[0].span_id).toBe(`cs-${parentLibSpanId}`);
    expect(rows[1].span_id).toBe(`cs-${baseSpan.span_id}`);
    expect(rows[1].parent_span_ids).toEqual([`cs-${parentLibSpanId}`]);
    expect(rows[1].trace_id).toBe(`cs-${parentLibSpanId}`);
    expect(rows[1].span_type).toBe("$lib-span");
  });

  it("keeps open intervals open and fills identity columns raw (unprefixed)", () => {
    const rows = buildBatchSpanRows({ ...baseOpts, spans: [baseSpan] });
    expect(rows[0]).toMatchObject({
      trace_id: "rti-rt1",
      span_type: "checkout-flow",
      ended_at: null,
      project_id: "p1",
      branch_id: "b1",
      user_id: "user1",
      team_id: null,
      refresh_token_id: "rt1",
      service_namespace: "commerce",
      service_name: "storefront",
      service_version: "abc123",
      service_instance_id: "iad-1",
      deployment_environment_name: "preview",
      resource_attributes: JSON.stringify({ region: "iad1" }),
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
    });
    expect(rows[0].started_at).toEqual(new Date(baseSpan.started_at_ms));
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
    expect(rows[0].ended_at).toEqual(new Date(endedAtMs));
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
    expect(rows[0].span_id).toBe(`pv-${baseSpan.span_id}`);
    expect(rows[0].span_type).toBe("$page-view");
    expect(rows[1].span_id).toBe("sas-0f000000-0000-4000-8000-000000000002");
    expect(rows[1].span_type).toBe("$away");
  });

  it("classifies HTTP autocapture as a client span without guessing kinds for other SDK spans", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, span_type: "$http-client" },
        { ...baseSpan, span_id: "0f000000-0000-4000-8000-000000000002", span_type: "$page-view" },
        { ...baseSpan, span_id: "0f000000-0000-4000-8000-000000000003", span_type: "checkout-flow" },
      ],
    });

    expect(rows.map((row) => row.kind)).toEqual(["client", "internal", "internal"]);
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
    })).toThrowError(/must not itself carry page_view_span_id, http_client_span_id, or parent_span_ids/);
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$page-view", parent_span_ids: ["0f000000-0000-4000-8000-00000000aaaa"] }],
    })).toThrowError(/must not itself carry page_view_span_id, http_client_span_id, or parent_span_ids/);
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$away", page_view_span_id: baseSpan.span_id }],
    })).toThrowError(/must not name itself/);
  });
});
