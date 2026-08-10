import { describe, expect, it, vi } from "vitest";
import { buildBatchSpanLinkRows, buildBatchSpanRows, clientUpdatedAtSpanVersion, getBatchDuplicateSpanIdError, insertSessionReplaySpans, insertSpanLinks, insertSpans, type BatchSpanWireItem } from "./spans";
import type { ClickHouseClient } from "./clickhouse";

// W3C ids: 32 hex for traces, 16 hex for spans. Written out literally rather than
// generated so the assertions below read as identity pass-through — which is the
// single most important property of this module now that the SDK owns identity.
const TRACE_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TRACE_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SPAN_ROOT = "1111111111111111";
const SPAN_CHILD = "2222222222222222";
const SPAN_PAGE_VIEW = "3333333333333333";

describe("clientUpdatedAtSpanVersion", () => {
  it("clamps a client clock to [1, now + 5min] so a skewed clock cannot mask later updates forever", () => {
    const nowMs = new Date("2026-01-01T00:10:00.000Z").getTime();
    expect(clientUpdatedAtSpanVersion(nowMs - 1_000, nowMs)).toBe(nowMs - 1_000);
    expect(clientUpdatedAtSpanVersion(0, nowMs)).toBe(1);
    expect(clientUpdatedAtSpanVersion(nowMs + 60 * 60 * 1000, nowMs)).toBe(nowMs + 5 * 60 * 1000);
  });
});

describe("insertSessionReplaySpans", () => {
  it("materializes refresh-token -> replay -> segment using scalar W3C parents", async () => {
    const insert = vi.fn(async () => {});
    const client = { insert } as unknown as ClickHouseClient;
    const replayStartedAt = new Date("2026-01-01T00:00:00.000Z");
    const replayLastEventAt = new Date("2026-01-01T00:05:00.000Z");
    const segmentStartedAt = new Date("2026-01-01T00:01:00.000Z");
    const segmentLastEventAt = new Date("2026-01-01T00:04:00.000Z");

    await insertSessionReplaySpans(client, {
      projectId: "p1",
      branchId: "b1",
      replayId: "22222222-2222-4222-8222-222222222222",
      sessionReplaySegmentId: "33333333-3333-4333-8333-333333333333",
      projectUserId: "user1",
      refreshTokenId: "11111111-1111-4111-8111-111111111111",
      replayStartedAt,
      replayLastEventAt,
      segmentStartedAt,
      segmentLastEventAt,
      resource: { service: { name: "storefront" } },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      table: "analytics_internal.spans",
      values: [
        expect.objectContaining({
          trace_id: "11111111111141118111111111111111",
          span_id: "8222222222222222",
          parent_span_id: "8111111111111111",
          span_type: "$session-replay",
          session_replay_segment_id: null,
          version: replayLastEventAt.getTime(),
        }),
        expect.objectContaining({
          trace_id: "11111111111141118111111111111111",
          span_id: "8333333333333333",
          parent_span_id: "8222222222222222",
          span_type: "$session-replay-segment",
          session_replay_segment_id: "33333333-3333-4333-8333-333333333333",
          version: segmentLastEventAt.getTime(),
        }),
      ],
    }));
  });
});

describe("getBatchDuplicateSpanIdError", () => {
  const span = (spanId: string): BatchSpanWireItem => ({
    trace_id: TRACE_A,
    span_id: spanId,
    parent_span_id: null,
    span_type: "checkout-flow",
    started_at_ms: 1,
    ended_at_ms: null,
    data: {},
    updated_at_ms: 1,
  });

  it("accepts distinct span ids", () => {
    expect(getBatchDuplicateSpanIdError([span(SPAN_ROOT), span(SPAN_CHILD)])).toBeNull();
  });

  it("rejects two rows sharing a span id, which would silently collapse in the ReplacingMergeTree", () => {
    expect(getBatchDuplicateSpanIdError([span(SPAN_ROOT), span(SPAN_ROOT)]))
      .toBe(`Duplicate span_id "${SPAN_ROOT}" in one batch`);
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
  const baseSpan: BatchSpanWireItem = {
    trace_id: TRACE_A,
    span_id: SPAN_ROOT,
    parent_span_id: null,
    span_type: "checkout-flow",
    started_at_ms: NOW_MS - 60_000,
    ended_at_ms: null,
    data: {},
    updated_at_ms: NOW_MS - 60_000,
  };

  it("stores W3C identity verbatim — no prefixing, no rewriting, no composed ancestry", () => {
    // THE behavioural contract of this module. The previous model rewrote the span
    // id with a kind prefix, derived a trace id from the session, and assembled a
    // parent array server-side; a regression to any of that would silently break
    // every cross-tier join, so assert pass-through explicitly.
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_id: SPAN_CHILD, parent_span_id: SPAN_ROOT }],
    });
    expect(rows[0]).toMatchObject({
      trace_id: TRACE_A,
      span_id: SPAN_CHILD,
      parent_span_id: SPAN_ROOT,
    });
  });

  it("keeps a null parent as null, which is how the trace_roots view identifies trace roots", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, span_type: "$page-view" }],
    });
    expect(rows[0]).toMatchObject({
      trace_id: TRACE_A,
      parent_span_id: null,
      refresh_token_id: "rt1",
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
    });
  });

  it("stamps session and page identity as scalar correlation columns, never as ancestry", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, page_view_span_id: SPAN_PAGE_VIEW }],
    });
    expect(rows[0]).toMatchObject({
      span_type: "checkout-flow",
      ended_at: null,
      project_id: "p1",
      branch_id: "b1",
      user_id: "user1",
      team_id: null,
      refresh_token_id: "rt1",
      session_replay_id: "replay1",
      session_replay_segment_id: "seg1",
      page_view_span_id: SPAN_PAGE_VIEW,
      service_namespace: "commerce",
      service_name: "storefront",
      service_version: "abc123",
      service_instance_id: "iad-1",
      deployment_environment_name: "preview",
      resource_attributes: JSON.stringify({ region: "iad1" }),
    });
    expect(rows[0].started_at).toEqual(new Date(baseSpan.started_at_ms));
    // Session identity must NOT have leaked into the hierarchy.
    expect(rows[0].parent_span_id).toBeNull();
    expect(rows[0].trace_id).toBe(TRACE_A);
  });

  it("leaves page correlation null when the client named no page view", () => {
    const rows = buildBatchSpanRows({ ...baseOpts, spans: [baseSpan] });
    expect(rows[0].page_view_span_id).toBeNull();
  });

  it("stores an authenticated library instrumentation scope separately from its operation name", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{
        ...baseSpan,
        span_type: "prisma:client:db_query",
        scope_name: "prisma",
        scope_version: "5.14.0",
        kind: "client",
        status_code: "error",
        status_message: "query failed",
      }],
    });
    expect(rows[0]).toMatchObject({
      span_type: "prisma:client:db_query",
      scope_name: "prisma",
      scope_version: "5.14.0",
      kind: "client",
      status_code: "error",
      status_message: "query failed",
      billing_item: null,
    });
  });

  it("classifies only native custom spans for billing before storage", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        baseSpan,
        { ...baseSpan, span_id: SPAN_CHILD, span_type: "$page-view" },
      ],
    });
    expect(rows.map((row) => row.billing_item)).toEqual(["analytics_spans", null]);
  });

  it("uses the client updated_at_ms as the version, clamped to [1, now + 5min]", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, updated_at_ms: NOW_MS - 1_000 },
        { ...baseSpan, span_id: SPAN_CHILD, updated_at_ms: 0 },
        { ...baseSpan, span_id: SPAN_PAGE_VIEW, updated_at_ms: NOW_MS + 60 * 60 * 1000 },
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

  it("defaults legacy spans without an explicit OTel kind to internal", () => {
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, span_type: "legacy.unknown" },
        { ...baseSpan, span_id: SPAN_CHILD, span_type: "$page-view" },
        { ...baseSpan, span_id: SPAN_PAGE_VIEW, span_type: "checkout-flow" },
        // Explicit wire kind remains authoritative.
        { ...baseSpan, span_id: "aaaaaaaaaaaaaaaa", span_type: "legacy.explicit", kind: "internal" },
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual(["internal", "internal", "internal", "internal"]);
    expect(rows.map((row) => row.status_code)).toEqual(["unset", "unset", "unset", "unset"]);
    expect(rows.every((row) => row.status_message === null)).toBe(true);
  });

  it("never promotes opaque data.status_code into the typed status column", () => {
    // Opaque legacy data must not leak into the typed OTel status column.
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [{
        ...baseSpan,
        span_type: "legacy.http",
        data: { status_code: 500, method: "GET" },
      }],
    });
    expect(rows[0].status_code).toBe("unset");
    expect(JSON.parse(rows[0].data)).toEqual({ status_code: 500, method: "GET" });
  });

  it("accepts a $page-view root and an ordinary child span", () => {
    // Both are root ACTIVITIES, but only a page view is always unparented: a fetch
    // issued inside a withSpan legitimately nests under that span, in the same
    // trace. Neither shape is special-cased any more.
    const rows = buildBatchSpanRows({
      ...baseOpts,
      spans: [
        { ...baseSpan, span_type: "$page-view", parent_span_id: null },
        { ...baseSpan, span_id: SPAN_CHILD, span_type: "checkout.request", parent_span_id: SPAN_ROOT },
      ],
    });
    expect(rows[0].parent_span_id).toBeNull();
    expect(rows[1].parent_span_id).toBe(SPAN_ROOT);
  });

  it("refuses a span that names itself as its own parent or its own page view", () => {
    // The route schema rejects both; these asserts keep the invariant for any
    // future non-route caller. A self-parent is a one-node cycle that the
    // dashboard's cycle-cut logic would then have to absorb, and a page view that
    // happened "on itself" is meaningless.
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, parent_span_id: baseSpan.span_id }],
    })).toThrowError(/must not name itself as its parent_span_id/);
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [{ ...baseSpan, page_view_span_id: baseSpan.span_id }],
    })).toThrowError(/must not name itself as its page_view_span_id/);
  });

  it("refuses a batch with duplicate span ids", () => {
    expect(() => buildBatchSpanRows({
      ...baseOpts,
      spans: [baseSpan, { ...baseSpan, span_type: "other" }],
    })).toThrowError(/Duplicate span_id/);
  });
});

describe("buildBatchSpanLinkRows", () => {
  const baseSpan: BatchSpanWireItem = {
    trace_id: TRACE_A,
    span_id: SPAN_ROOT,
    parent_span_id: null,
    span_type: "consume-job",
    started_at_ms: 1,
    ended_at_ms: 2,
    data: {},
    updated_at_ms: 2,
  };

  it("keys each link by the OWNER's trace, so a cross-trace link stays visible from the trace that declared it", () => {
    const rows = buildBatchSpanLinkRows({
      projectId: "p1",
      branchId: "b1",
      spans: [{ ...baseSpan, links: [{ trace_id: TRACE_B, span_id: SPAN_CHILD }] }],
    });
    expect(rows).toEqual([{
      project_id: "p1",
      branch_id: "b1",
      trace_id: TRACE_A,
      owner_span_id: SPAN_ROOT,
      linked_trace_id: TRACE_B,
      linked_span_id: SPAN_CHILD,
      linked_project_id: "p1",
      linked_branch_id: "b1",
    }]);
  });

  it("accepts trusted cross-project target metadata without changing owner scope", () => {
    const rows = buildBatchSpanLinkRows({
      projectId: "internal",
      branchId: "main",
      spans: [{
        ...baseSpan,
        links: [{
          trace_id: TRACE_B,
          span_id: SPAN_CHILD,
          linked_project_id: "customer-project",
          linked_branch_id: "production",
        }],
      }],
    });
    expect(rows[0]).toMatchObject({
      project_id: "internal",
      branch_id: "main",
      linked_project_id: "customer-project",
      linked_branch_id: "production",
    });
  });

  it("flattens links across every span in the batch", () => {
    const rows = buildBatchSpanLinkRows({
      projectId: "p1",
      branchId: "b1",
      spans: [
        { ...baseSpan, links: [{ trace_id: TRACE_B, span_id: SPAN_CHILD }] },
        { ...baseSpan, span_id: SPAN_CHILD, links: [{ trace_id: TRACE_A, span_id: SPAN_ROOT }] },
      ],
    });
    expect(rows.map((row) => [row.owner_span_id, row.linked_span_id])).toEqual([
      [SPAN_ROOT, SPAN_CHILD],
      [SPAN_CHILD, SPAN_ROOT],
    ]);
  });

  it("emits nothing for spans without links", () => {
    expect(buildBatchSpanLinkRows({ projectId: "p1", branchId: "b1", spans: [baseSpan] })).toEqual([]);
  });
});

describe("insert guards", () => {
  it("does not call insert when given an empty row list", async () => {
    const insert = vi.fn(async () => {});
    const client = { insert } as unknown as ClickHouseClient;
    await insertSpans(client, []);
    await insertSpanLinks(client, []);
    expect(insert).not.toHaveBeenCalled();
  });
});
