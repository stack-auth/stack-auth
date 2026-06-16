// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { Result } from "@hexclave/shared/dist/utils/results";
import { analyticsOptionsFromJson, analyticsOptionsToJson, getSessionReplayOptions, SessionRecorder } from "./session-replay";

describe("session replay options", () => {
  it("enables replays by default", () => {
    expect(getSessionReplayOptions(undefined).enabled).toBe(true);
    expect(getSessionReplayOptions({}).enabled).toBe(true);
    expect(getSessionReplayOptions({ replays: {} }).enabled).toBe(true);
  });

  it("preserves explicit replay opt-out", () => {
    expect(getSessionReplayOptions({ replays: { enabled: false } }).enabled).toBe(false);
  });
});

describe("analytics option JSON conversion", () => {
  it("preserves top-level analytics options when serializing replay block classes", () => {
    const json = analyticsOptionsToJson({
      enabled: false,
      replays: {
        enabled: true,
        blockClass: /stack-sensitive/u,
      },
    });

    expect(json?.enabled).toBe(false);
    expect(json?.replays?.enabled).toBe(true);
  });

  it("preserves top-level analytics options when deserializing replay block classes", () => {
    const roundTripped = analyticsOptionsFromJson(analyticsOptionsToJson({
      enabled: false,
      replays: {
        blockClass: /stack-sensitive/u,
      },
    }));

    expect(roundTripped?.enabled).toBe(false);
    expect(roundTripped?.replays?.blockClass).toEqual(/stack-sensitive/u);
  });
});

describe("SessionRecorder flush", () => {
  it("silently disables when server responds with ANALYTICS_NOT_ENABLED", async () => {
    vi.useFakeTimers();

    // Seed localStorage with a valid session so _flush doesn't fail on getOrRotateSession
    const storageKey = `hexclave:session-replay:v1:test-project`;
    localStorage.setItem(storageKey, JSON.stringify({
      session_id: "test-session",
      created_at_ms: Date.now(),
      last_activity_ms: Date.now(),
    }));

    const sentBodies: string[] = [];
    const recorder = new SessionRecorder(
      {
        projectId: "test-project",
        sendBatch: async (body) => {
          sentBodies.push(body);
          return Result.ok(new Response(
            JSON.stringify({ code: "ANALYTICS_NOT_ENABLED", error: "Analytics is not enabled for this project." }),
            {
              status: 400,
              headers: { "x-stack-known-error": "ANALYTICS_NOT_ENABLED" },
            },
          ));
        },
      },
      {},
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // Inject an event directly into the recorder's buffer to test flush behavior
      // without needing rrweb. We access private fields for testing purposes.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [{ type: 2, timestamp: Date.now(), data: {} }];

      // Manually trigger a tick (which calls _flush)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      // One batch should have been sent
      expect(sentBodies).toHaveLength(1);

      // No console.warn about "SessionRecorder flush failed" should have been emitted
      const flushWarnings = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("SessionRecorder")
      );
      expect(flushWarnings).toHaveLength(0);

      // After disabling, pushing new events and triggering another tick should not send
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [{ type: 3, timestamp: Date.now(), data: {} }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);
      expect(sentBodies).toHaveLength(1);
    } finally {
      recorder.stop();
      warnSpy.mockRestore();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });
});
