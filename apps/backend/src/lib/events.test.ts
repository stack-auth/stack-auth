import { beforeEach, describe, expect, it, vi } from "vitest";

const clickhouseInsertMock = vi.fn();
const otelEmitMock = vi.fn();
const activeSpanAddEventMock = vi.fn();
const getActiveSpanMock = vi.fn(() => ({
  addEvent: activeSpanAddEventMock,
}));

vi.mock("./clickhouse", () => ({
  getClickhouseAdminClient: () => ({
    insert: clickhouseInsertMock,
  }),
}));

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: () => ({
      emit: otelEmitMock,
    }),
  },
  SeverityNumber: {
    INFO: 9,
  },
}));

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startActiveSpan: async (_name: string, callback: (span: { end: () => void }) => Promise<unknown>) => await callback({ end: () => {} }),
    }),
    getActiveSpan: getActiveSpanMock,
  },
}));

describe("insertAnalyticsEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts events and fans out the normalized envelope to telemetry and logs", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { insertAnalyticsEvents } = await import("./events");

    await insertAnalyticsEvents([{
      event_type: "checkout.completed",
      event_id: "00000000-0000-4000-8000-000000000001",
      trace_id: null,
      event_at: new Date("2026-03-23T12:00:00.000Z"),
      parent_span_ids: [],
      data: {
        text: "broken \uD83C",
      },
      project_id: "project-id",
      branch_id: "main",
      user_id: "user-id",
      team_id: null,
      refresh_token_id: null,
      session_replay_id: null,
      session_replay_segment_id: null,
      from_server: false,
    }]);

    expect(clickhouseInsertMock).toHaveBeenCalledTimes(1);
    expect(clickhouseInsertMock.mock.calls[0][0]).toMatchObject({
      table: "analytics_internal.events",
      values: [{
        event_type: "checkout.completed",
        event_id: "00000000-0000-4000-8000-000000000001",
        parent_span_ids: [],
        data: {
          text: "broken \uFFFD",
        },
      }],
    });

    expect(otelEmitMock).toHaveBeenCalledTimes(1);
    expect(otelEmitMock.mock.calls[0][0]).toMatchObject({
      body: expect.stringContaining("\"event_type\":\"checkout.completed\""),
    });

    expect(activeSpanAddEventMock).toHaveBeenCalledTimes(1);
    expect(activeSpanAddEventMock).toHaveBeenCalledWith(
      "stack.analytics.event",
      expect.objectContaining({
        "stack.analytics.event_type": "checkout.completed",
      }),
    );

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy.mock.calls[0][0]).toContain("\"type\":\"stack.analytics.event\"");
    expect(consoleInfoSpy.mock.calls[0][0]).toContain("\"event_type\":\"checkout.completed\"");

    consoleInfoSpy.mockRestore();
  });
});
