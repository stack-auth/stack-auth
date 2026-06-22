// @vitest-environment jsdom

import { KnownErrors } from "@hexclave/shared/dist/known-errors";
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
  it("silently disables when client interface returns ANALYTICS_NOT_ENABLED as an error", async () => {
    vi.useFakeTimers();

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
          return Result.error(new KnownErrors.AnalyticsNotEnabled());
        },
      },
      {},
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [{ type: 2, timestamp: Date.now(), data: {} }];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentBodies).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();

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
