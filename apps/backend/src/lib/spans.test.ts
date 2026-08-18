import { describe, expect, it, vi } from "vitest";
import { insertSessionReplaySpans, insertSpanLinks, insertSpans, type SpanInsertRow } from "./spans";
import type { ClickHouseClient } from "./clickhouse";

// W3C ids: 32 hex for traces, 16 hex for spans. Written out literally rather than
// generated so the assertions below read as identity pass-through — which is the
// single most important property of this module now that the SDK owns identity.
const TRACE_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPAN_ROOT = "1111111111111111";

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

describe("insert guards", () => {
  it("does not call insert when given an empty row list", async () => {
    const insert = vi.fn(async () => {});
    const client = { insert } as unknown as ClickHouseClient;
    await insertSpans(client, []);
    await insertSpanLinks(client, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it("deduplicates dependent trace views when a span batch is retried", async () => {
    const insert = vi.fn(async () => {});
    const client = { insert } as unknown as ClickHouseClient;
    const row = {
      trace_id: TRACE_A,
      span_id: SPAN_ROOT,
      span_type: "checkout-flow",
      billing_item: null,
      started_at: new Date("2026-01-01T00:00:00.000Z"),
      ended_at: null,
      parent_span_id: null,
      data: "{}",
      kind: "internal",
      status_code: "unset",
      status_message: null,
      service_namespace: null,
      service_name: "storefront",
      service_version: null,
      service_instance_id: null,
      deployment_environment_name: null,
      resource_attributes: "{}",
      producer: "sdk",
      project_id: "p1",
      branch_id: "b1",
      user_id: null,
      team_id: null,
      refresh_token_id: null,
      session_replay_id: null,
      session_replay_segment_id: null,
      page_view_span_id: null,
      version: 1,
    } satisfies SpanInsertRow;

    await insertSpans(client, [row], { deduplicationToken: "retry-token" });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      table: "analytics_internal.spans",
      clickhouse_settings: expect.objectContaining({
        insert_deduplication_token: "retry-token",
        deduplicate_blocks_in_dependent_materialized_views: 1,
      }),
    }));
  });
});
