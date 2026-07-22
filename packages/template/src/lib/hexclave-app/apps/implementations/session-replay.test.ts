// @vitest-environment jsdom

import { KnownErrors } from "@hexclave/shared/dist/known-errors";
import { describe, expect, it, vi } from "vitest";
import * as errors from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { analyticsOptionsFromJson, analyticsOptionsToJson, canInlineStylesheetLink, getSessionReplayOptions, SessionRecorder } from "./session-replay";

const rrwebMocks = vi.hoisted(() => {
  const takeFullSnapshot = vi.fn();
  const record = Object.assign(vi.fn(() => () => {}), { takeFullSnapshot });
  return { record, takeFullSnapshot };
});
vi.mock("rrweb", () => ({ record: rrwebMocks.record }));

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

describe("canInlineStylesheetLink", () => {
  function makeLink(sheet: unknown): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    Object.defineProperty(link, "sheet", { value: sheet });
    return link;
  }

  it("is false when the sheet hasn't been attached", () => {
    expect(canInlineStylesheetLink(makeLink(null))).toBe(false);
  });

  it("is false when reading cssRules throws (cross-origin without CORS)", () => {
    const sheet = {
      get cssRules(): CSSRuleList {
        throw new DOMException("not allowed", "SecurityError");
      },
    };
    expect(canInlineStylesheetLink(makeLink(sheet))).toBe(false);
  });

  it("is false for an empty sheet", () => {
    expect(canInlineStylesheetLink(makeLink({ cssRules: [] }))).toBe(false);
  });

  it("is true for a readable non-empty sheet", () => {
    expect(canInlineStylesheetLink(makeLink({ cssRules: [{}] }))).toBe(true);
  });
});

describe("SessionRecorder stylesheet re-snapshot", () => {
  function makeRecorder() {
    return new SessionRecorder(
      {
        projectId: "test-project",
        sendBatch: async () => Result.ok(new Response("ok", { status: 200 })),
      },
      {},
    );
  }

  async function startRecorder(recorder: SessionRecorder) {
    recorder.start();
    // Flush the dynamic import("rrweb") microtasks so record() runs and the
    // stylesheet-load listener is attached.
    await vi.advanceTimersByTimeAsync(0);
    expect(rrwebMocks.record).toHaveBeenCalledTimes(1);
  }

  function attachStylesheetLink(options: { sheet: unknown }): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://example.com/app.css";
    Object.defineProperty(link, "sheet", { value: options.sheet });
    document.head.appendChild(link);
    return link;
  }

  it("re-takes a full snapshot (debounced) when a stylesheet finishes loading during recording", async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const recorder = makeRecorder();

    try {
      await startRecorder(recorder);

      const link = attachStylesheetLink({ sheet: { cssRules: [{}] } });
      link.dispatchEvent(new Event("load"));

      // Debounced: nothing happens immediately...
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(900);
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();

      // ...and a second stylesheet finishing resets the debounce window...
      const link2 = attachStylesheetLink({ sheet: { cssRules: [{}] } });
      link2.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(900);
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();

      // ...then exactly ONE snapshot fires for both stylesheets.
      await vi.advanceTimersByTimeAsync(200);
      expect(rrwebMocks.takeFullSnapshot).toHaveBeenCalledTimes(1);

      // No further snapshots without further stylesheet loads.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rrwebMocks.takeFullSnapshot).toHaveBeenCalledTimes(1);

      link.remove();
      link2.remove();
    } finally {
      recorder.stop();
      vi.useRealTimers();
    }
  });

  it("does not re-snapshot for stylesheets rrweb can't inline, or for non-stylesheet loads", async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const recorder = makeRecorder();

    try {
      await startRecorder(recorder);

      // Cross-origin stylesheet without CORS: cssRules access throws.
      const crossOriginLink = attachStylesheetLink({
        sheet: {
          get cssRules(): CSSRuleList {
            throw new DOMException("not allowed", "SecurityError");
          },
        },
      });
      crossOriginLink.dispatchEvent(new Event("load"));

      // Image load events must be ignored.
      const img = document.createElement("img");
      document.body.appendChild(img);
      img.dispatchEvent(new Event("load"));

      await vi.advanceTimersByTimeAsync(10_000);
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();

      crossOriginLink.remove();
      img.remove();
    } finally {
      recorder.stop();
      vi.useRealTimers();
    }
  });

  it("cancels a pending re-snapshot when recording stops", async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const recorder = makeRecorder();

    try {
      await startRecorder(recorder);

      const link = attachStylesheetLink({ sheet: { cssRules: [{}] } });
      link.dispatchEvent(new Event("load"));

      recorder.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();

      // The listener is detached too: loads after stop() schedule nothing.
      link.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rrwebMocks.takeFullSnapshot).not.toHaveBeenCalled();

      link.remove();
    } finally {
      recorder.stop();
      vi.useRealTimers();
    }
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

  it("keeps all batches from one flush on the segment id captured before sign-out rotation", async () => {
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
          recorder.setSessionReplaySegmentId("new-segment");
          return Result.ok(new Response("ok", { status: 200 }));
        },
        sessionReplaySegmentId: "old-segment",
      },
      {},
    );

    try {
      // Force two batches so the second payload is built after sendBatch's
      // await boundary has had a chance to rotate the recorder id.
      const largeData = "x".repeat(500_000);
      const event1 = { type: 2, timestamp: Date.now(), data: largeData };
      const event2 = { type: 3, timestamp: Date.now(), data: largeData };
      const sizeOf = (e: unknown) => new TextEncoder().encode(JSON.stringify(e)).byteLength;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [event1, event2];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [sizeOf(event1), sizeOf(event2)];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = sizeOf(event1) + sizeOf(event2);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (recorder as any)._flush({ keepalive: false });

      expect(sentBodies).toHaveLength(2);
      const batch1 = JSON.parse(sentBodies[0]);
      const batch2 = JSON.parse(sentBodies[1]);
      expect(batch1.session_replay_segment_id).toBe("old-segment");
      expect(batch2.session_replay_segment_id).toBe("old-segment");
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

      // Sent (not dropped): the transport gzips it under the wire limit.
      expect(sentBodies).toHaveLength(1);
      const batch = JSON.parse(sentBodies[0]);
      expect(batch.events).toHaveLength(1);
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

  it("drops a single event that exceeds the server's decompressed budget", async () => {
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
      // >8MB (MAX_SINGLE_EVENT_BYTES) is dropped; the next event still sends.
      const hugeEvent = { type: 2, timestamp: Date.now(), data: "z".repeat(9_000_000) };
      const smallEvent = { type: 3, timestamp: Date.now(), data: "ok" };
      const sizeOf = (e: unknown) => JSON.stringify(e).length;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [hugeEvent, smallEvent];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [sizeOf(hugeEvent), sizeOf(smallEvent)];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = sizeOf(hugeEvent) + sizeOf(smallEvent);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (recorder as any)._tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentBodies).toHaveLength(1);
      const batch = JSON.parse(sentBodies[0]);
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0].type).toBe(3);
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

  it("on a keepalive flush, drops an event over the uncompressed batch target (it can't be gzipped before page tear-down)", async () => {
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
      // ~2MB is under the 8MB gzipped ceiling but over the 900KB uncompressed
      // batch target. Keepalive flushes skip gzip, so this event would 413 the
      // server's ~1MB raw body limit; it must be dropped, but the next event
      // (small enough to send raw) still goes out.
      const midEvent = { type: 2, timestamp: Date.now(), data: "z".repeat(2_000_000) };
      const smallEvent = { type: 3, timestamp: Date.now(), data: "ok" };
      const sizeOf = (e: unknown) => new TextEncoder().encode(JSON.stringify(e)).byteLength;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [midEvent, smallEvent];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [sizeOf(midEvent), sizeOf(smallEvent)];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = sizeOf(midEvent) + sizeOf(smallEvent);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (recorder as any)._flush({ keepalive: true });

      expect(sentBodies).toHaveLength(1);
      const batch = JSON.parse(sentBodies[0]);
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0].type).toBe(3);
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      vi.useRealTimers();
    }
  });

  it("logs a distinct 413 warning and drops the buffered events when the server rejects a batch as too large", async () => {
    vi.useFakeTimers();
    const captureWarningSpy = vi.spyOn(errors, "captureWarning").mockImplementation(() => {});

    const storageKey = `hexclave:session-replay:v1:test-project`;
    localStorage.setItem(storageKey, JSON.stringify({
      session_id: "test-session",
      created_at_ms: Date.now(),
      last_activity_ms: Date.now(),
    }));

    let calls = 0;
    const recorder = new SessionRecorder(
      {
        projectId: "test-project",
        sendBatch: async () => {
          calls += 1;
          // A poorly-compressible event can clear the client-side caps yet still
          // exceed the server's body limit after gzip → 413.
          return Result.ok(new Response("payload too large", { status: 413 }));
        },
      },
      {},
    );

    try {
      const eventA = { type: 3, timestamp: Date.now(), data: "a" };
      const eventB = { type: 3, timestamp: Date.now(), data: "b" };
      const sizeOf = (e: unknown) => new TextEncoder().encode(JSON.stringify(e)).byteLength;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._events = [eventA, eventB];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._eventSizes = [sizeOf(eventA), sizeOf(eventB)];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (recorder as any)._approxBytes = sizeOf(eventA) + sizeOf(eventB);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (recorder as any)._flush({ keepalive: false });

      // The 413 stops the loop; no retry of the rejected batch.
      expect(calls).toBe(1);
      expect(captureWarningSpy).toHaveBeenCalledTimes(1);
      const warned = captureWarningSpy.mock.calls[0]?.[1];
      expect(warned).toBeInstanceOf(Error);
      expect((warned as Error).message).toContain("413");
      // Both buffered events are reported as dropped.
      expect((warned as Error).message).toContain("2 buffered event");
    } finally {
      recorder.stop();
      localStorage.removeItem(storageKey);
      captureWarningSpy.mockRestore();
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
