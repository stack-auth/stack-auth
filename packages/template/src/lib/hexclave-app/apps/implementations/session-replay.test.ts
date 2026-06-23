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
  it("silently ignores network errors caused by ad blockers", async () => {
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
          return Result.error(new TypeError("Failed to fetch"));
        },
      },
      {},
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const event1 = { type: 2, timestamp: Date.now(), data: {} };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(event1).length];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentBodies).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();

      // Unlike ANALYTICS_NOT_ENABLED, ad blocker errors do NOT disable the
      // recorder — subsequent flushes continue attempting delivery.
      const event2 = { type: 3, timestamp: Date.now(), data: {} };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event2];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(event2).length];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);
      expect(sentBodies).toHaveLength(2);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      recorder.stop();
      warnSpy.mockRestore();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

  it("splits large batches into multiple requests to stay under server 1MB limit", async () => {
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
          return Result.ok(new Response("ok", { status: 200 }));
        },
      },
      {},
    );

    try {
      // Create events that together exceed 900KB (the per-batch cap).
      // Each event is ~500KB, so two events (~1MB) must be split into two batches.
      const largeData = "x".repeat(500_000);
      const event1 = { type: 2, timestamp: Date.now(), data: largeData };
      const event2 = { type: 3, timestamp: Date.now(), data: largeData };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event1, event2];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(event1).length, JSON.stringify(event2).length];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = JSON.stringify(event1).length + JSON.stringify(event2).length;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      // Should have sent two separate batches
      expect(sentBodies).toHaveLength(2);

      // Each batch should contain exactly one event
      const batch1 = JSON.parse(sentBodies[0]);
      const batch2 = JSON.parse(sentBodies[1]);
      expect(batch1.events).toHaveLength(1);
      expect(batch2.events).toHaveLength(1);

      // They should have different batch IDs
      expect(batch1.batch_id).not.toBe(batch2.batch_id);
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

  it("sends a single oversized event alone without dropping it", async () => {
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
          return Result.ok(new Response("ok", { status: 200 }));
        },
      },
      {},
    );

    try {
      // A single event larger than 900KB — should still be sent (not dropped)
      const hugeData = "y".repeat(1_000_000);
      const hugeEvent = { type: 2, timestamp: Date.now(), data: hugeData };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [hugeEvent];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(hugeEvent).length];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = JSON.stringify(hugeEvent).length;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      // Should still send the event (the server may reject it, but we don't drop it client-side)
      expect(sentBodies).toHaveLength(1);
      const batch = JSON.parse(sentBodies[0]);
      expect(batch.events).toHaveLength(1);
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

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
      const event1 = { type: 2, timestamp: Date.now(), data: {} };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(event1).length];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentBodies).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();

      const event2 = { type: 3, timestamp: Date.now(), data: {} };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event2];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [JSON.stringify(event2).length];
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
