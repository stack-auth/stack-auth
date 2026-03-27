// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { EventTracker } from "./event-tracker";

const analyticsEnvVarNames = [
  "NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_THRESHOLD",
  "NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_WINDOW_MS",
  "NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_RADIUS_PX",
  "NEXT_PUBLIC_STACK_ANALYTICS_SCROLL_DEPTH_STEP_PERCENT",
] as const;

const originalAnalyticsEnv = new Map(analyticsEnvVarNames.map((name) => [name, process.env[name]]));

const flushTimersAndMicrotasks = async () => {
  vi.advanceTimersByTime(10_000);
  await Promise.resolve();
};

const setDocumentVisibility = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: visibilityState === "hidden",
  });
};

const restoreAnalyticsEnv = () => {
  for (const name of analyticsEnvVarNames) {
    const original = originalAnalyticsEnv.get(name);
    if (original == null) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
};

const setScrollState = (options: { scrollY: number, innerHeight: number, scrollHeight: number }) => {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: options.scrollY,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: options.innerHeight,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: options.scrollHeight,
  });
};

describe("EventTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
    setDocumentVisibility("visible");
    restoreAnalyticsEnv();
    document.body.innerHTML = "";
  });

  it("batches manual track() calls with auto-captured page views", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    tracker.trackEvent("checkout.completed", { amount: 4200 });

    await flushTimersAndMicrotasks();
    await flushTimersAndMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: { event_type: string }[],
    };
    expect(payload.events.map((event) => event.event_type)).toEqual([
      "$page-view",
      "checkout.completed",
    ]);

    tracker.stop();
  });

  it("attaches replay linkage from the current replay context to auto-captured and manual events", async () => {
    vi.useFakeTimers();

    const sessionReplayId = "11111111-1111-4111-8111-111111111111";
    const sessionReplaySegmentId = "22222222-2222-4222-8222-222222222222";
    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      getReplayLinkOptions: () => ({
        sessionReplayId,
        sessionReplaySegmentId,
      }),
      sendBatch,
    });

    tracker.start();
    tracker.trackEvent("checkout.completed", { amount: 4200 });

    await flushTimersAndMicrotasks();
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      session_replay_id?: string,
      session_replay_segment_id?: string,
      events: Array<{ event_type: string, session_replay_id?: string, session_replay_segment_id?: string }>,
    };
    expect(payload.session_replay_id).toBe(sessionReplayId);
    expect(payload.session_replay_segment_id).toBe(sessionReplaySegmentId);
    expect(payload.events).toMatchObject([
      {
        event_type: "$page-view",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        session_replay_id: sessionReplayId,
        session_replay_segment_id: sessionReplaySegmentId,
      },
      {
        event_type: "checkout.completed",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        session_replay_id: sessionReplayId,
        session_replay_segment_id: sessionReplaySegmentId,
      },
    ]);

    tracker.stop();
  });

  it("flushes queued manual events on pagehide with keepalive", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.trackEvent("cart.abandoned", { reason: "timeout" });
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][1]).toEqual({ keepalive: true });

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: { event_type: string }[],
    };
    expect(payload.events.map((event) => event.event_type)).toEqual(["cart.abandoned"]);

    tracker.stop();
  });

  it("allows manual trackEvent() calls to override replay linkage", async () => {
    vi.useFakeTimers();

    const defaultSessionReplayId = "33333333-3333-4333-8333-333333333333";
    const defaultSessionReplaySegmentId = "44444444-4444-4444-8444-444444444444";
    const overrideSessionReplayId = "55555555-5555-4555-8555-555555555555";
    const overrideSessionReplaySegmentId = "66666666-6666-4666-8666-666666666666";
    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      getReplayLinkOptions: () => ({
        sessionReplayId: defaultSessionReplayId,
        sessionReplaySegmentId: defaultSessionReplaySegmentId,
      }),
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.trackEvent("checkout.completed", { amount: 4200 }, {
      sessionReplayId: overrideSessionReplayId,
      sessionReplaySegmentId: overrideSessionReplaySegmentId,
    });
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: Array<{ event_type: string, session_replay_id?: string, session_replay_segment_id?: string }>,
    };
    expect(payload.events).toMatchObject([{
      event_type: "checkout.completed",
      event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
      session_replay_id: overrideSessionReplayId,
      session_replay_segment_id: overrideSessionReplaySegmentId,
    }]);

    tracker.stop();
  });

  it("captures focus, submit, clipboard, and error events without clipboard contents", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    const form = document.createElement("form");
    form.action = "https://example.com/submit";
    form.method = "post";
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Save";
    form.append(input, button);
    document.body.append(form);

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: button,
    });
    form.dispatchEvent(submitEvent);

    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", {
      configurable: true,
      value: {
        types: ["text/plain"],
        getData: () => "top-secret-copy-value",
      },
    });
    input.dispatchEvent(copyEvent);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        types: ["text/plain", "text/html"],
        getData: () => "top-secret-paste-value",
      },
    });
    input.dispatchEvent(pasteEvent);

    window.dispatchEvent(new ErrorEvent("error", {
      message: "Boom",
      filename: "app.js",
      lineno: 10,
      colno: 4,
      error: new Error("Boom"),
    }));

    await flushTimersAndMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][0]).not.toContain("top-secret-copy-value");
    expect(sendBatch.mock.calls[0][0]).not.toContain("top-secret-paste-value");

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: Array<{ event_type: string, data: Record<string, unknown> }>,
    };
    expect(payload.events.map((event) => event.event_type)).toEqual([
      "$window-blur",
      "$window-focus",
      "$submit",
      "$copy",
      "$paste",
      "$error",
    ]);
    expect(payload.events[2]?.data).toMatchObject({
      action: "https://example.com/submit",
      method: "post",
      submitter_tag_name: "button",
    });
    expect(payload.events[3]?.data).toMatchObject({
      clipboard_types: ["text/plain"],
    });
    expect(payload.events[4]?.data).toMatchObject({
      clipboard_types: ["text/plain", "text/html"],
    });
    expect(payload.events[5]?.data).toMatchObject({
      error_message: "Boom",
      error_name: "Error",
      source: "window-error",
    });

    tracker.stop();
  });

  it("emits scroll depth markers using the configured step percent", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_STACK_ANALYTICS_SCROLL_DEPTH_STEP_PERCENT = "50";

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    setScrollState({ scrollY: 300, innerHeight: 300, scrollHeight: 1_000 });
    window.dispatchEvent(new Event("scroll"));
    setScrollState({ scrollY: 800, innerHeight: 300, scrollHeight: 1_000 });
    window.dispatchEvent(new Event("scroll"));

    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: Array<{ event_type: string, data: Record<string, unknown> }>,
    };
    expect(payload.events).toMatchObject([
      {
        event_type: "$scroll-depth",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        data: { depth_percent: 50, step_percent: 50 },
      },
      {
        event_type: "$scroll-depth",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        data: { depth_percent: 100, step_percent: 50 },
      },
    ]);

    tracker.stop();
  });

  it("emits a rage-click event when repeated clicks cross the configured threshold", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_THRESHOLD = "3";
    process.env.NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_RADIUS_PX = "30";

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    const button = document.createElement("button");
    button.textContent = "Retry";
    document.body.append(button);

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    for (let i = 0; i < 3; i++) {
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      });
      Object.defineProperty(clickEvent, "pageX", {
        configurable: true,
        value: 20,
      });
      Object.defineProperty(clickEvent, "pageY", {
        configurable: true,
        value: 20,
      });
      button.dispatchEvent(clickEvent);
    }

    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: Array<{ event_type: string, data: Record<string, unknown> }>,
    };
    expect(payload.events.map((event) => event.event_type)).toEqual([
      "$click",
      "$click",
      "$click",
      "$rage-click",
    ]);
    expect(payload.events[3]?.data).toMatchObject({
      click_count: 3,
      radius_px: 30,
      tag_name: "button",
    });

    tracker.stop();
  });

  it("throws when analytics threshold env vars are invalid", () => {
    process.env.NEXT_PUBLIC_STACK_ANALYTICS_SCROLL_DEPTH_STEP_PERCENT = "0";

    expect(() => new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch: async () => Result.ok(new Response(null, { status: 200 })),
    })).toThrowError("Invalid NEXT_PUBLIC_STACK_ANALYTICS_SCROLL_DEPTH_STEP_PERCENT environment variable");
  });

  it("captures $tab-out and $tab-in events on visibility changes", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (body: string, _options: { keepalive: boolean }) => {
      return Result.ok(new Response(body, { status: 200 }));
    });

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    setDocumentVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][1]).toEqual({ keepalive: true });
    expect(JSON.parse(sendBatch.mock.calls[0][0])).toMatchObject({
      events: [{
        event_type: "$tab-out",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        data: {
          hidden: true,
          path: "/",
          visibility_state: "hidden",
        },
      }],
    });

    sendBatch.mockClear();

    setDocumentVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][1]).toEqual({ keepalive: true });
    expect(JSON.parse(sendBatch.mock.calls[0][0])).toMatchObject({
      events: [{
        event_type: "$tab-in",
        event_id: expect.stringMatching(/^[0-9a-f]{8}-/),
        data: {
          hidden: false,
          path: "/",
          visibility_state: "visible",
        },
      }],
    });

    tracker.stop();
  });

  it("rejects reserved event names for manual custom events", () => {
    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch: async () => Result.ok(new Response(null, { status: 200 })),
    });

    expect(() => tracker.trackEvent("$checkout.completed", {})).toThrowError(
      'Custom analytics event types cannot start with "$": $checkout.completed',
    );
  });

  // ---------- beforeSend ----------

  it("beforeSend can modify event data", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      beforeSend: (event) => ({ ...event, data: { ...event.data, injected: true } }),
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.trackEvent("test.event", { original: true });
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ data: Record<string, unknown> }> };
    expect(payload.events[0]!.data).toMatchObject({ original: true, injected: true });
    tracker.stop();
  });

  it("beforeSend can drop events by returning null", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      beforeSend: () => null,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.trackEvent("test.event", { should_be_dropped: true });
    await flushTimersAndMicrotasks();

    expect(sendBatch).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("beforeSend errors are swallowed and the event still enqueues", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      beforeSend: () => { throw new Error("user bug"); },
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.trackEvent("test.event", { value: 1 });
    await flushTimersAndMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    tracker.stop();
  });

  // ---------- Fingerprinting ----------

  it("auto-generates $fingerprint for $error events", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.captureException(new Error("test error"));
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string, data: Record<string, unknown> }> };
    const errorEvent = payload.events.find((e) => e.event_type === "$error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.$fingerprint).toBeDefined();
    expect(Array.isArray(errorEvent!.data.$fingerprint)).toBe(true);
    expect((errorEvent!.data.$fingerprint as string[])[0]).toBe("Error");
    tracker.stop();
  });

  it("user-supplied fingerprint overrides auto-generated one", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.captureException(new Error("test"), { fingerprint: ["custom", "group"] });
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ data: Record<string, unknown> }> };
    expect(payload.events[0]!.data.$fingerprint).toEqual(["custom", "group"]);
    tracker.stop();
  });

  it("beforeSend can set fingerprint on an event", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      beforeSend: (event) => ({ ...event, fingerprint: ["from-hook"] }),
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    tracker.captureException(new Error("x"));
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ data: Record<string, unknown> }> };
    expect(payload.events[0]!.data.$fingerprint).toEqual(["from-hook"]);
    tracker.stop();
  });

  // ---------- Error Deduplication ----------

  it("deduplicates consecutive identical errors", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      errorDedupWindowMs: 5000,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    // Fire 5 identical errors rapidly
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new ErrorEvent("error", {
        message: "Same error",
        error: new Error("Same error"),
      }));
    }

    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string, data: Record<string, unknown> }> };
    const errorEvents = payload.events.filter((e) => e.event_type === "$error");
    // Should have only the first occurrence enqueued (dedup summary flushed on timer)
    expect(errorEvents.length).toBe(2); // first error + dedup summary
    const dedupEvent = errorEvents.find((e) => typeof e.data.deduplicated_count === "number");
    expect(dedupEvent).toBeDefined();
    expect(dedupEvent!.data.deduplicated_count).toBe(4);

    tracker.stop();
  });

  it("does not deduplicate when window is 0 (disabled)", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      errorDedupWindowMs: 0,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new ErrorEvent("error", {
        message: "Repeated",
        error: new Error("Repeated"),
      }));
    }

    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string }> };
    const errorEvents = payload.events.filter((e) => e.event_type === "$error");
    expect(errorEvents.length).toBe(3);

    tracker.stop();
  });

  // ---------- console.error capture ----------

  it("captures console.error as $error events when enabled", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));
    const originalConsoleError = console.error;

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      captureConsoleErrors: true,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    console.error("something went wrong");
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string, data: Record<string, unknown> }> };
    const errorEvent = payload.events.find((e) => e.event_type === "$error" && e.data.source === "console-error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error_message).toBe("something went wrong");

    tracker.stop();
    // Ensure original was restored
    expect(console.error).toBe(originalConsoleError);
  });

  it("captures console.error with Error objects", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      captureConsoleErrors: true,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    console.error(new Error("Error object"));
    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string, data: Record<string, unknown> }> };
    const errorEvent = payload.events.find((e) => e.event_type === "$error" && e.data.source === "console-error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error_name).toBe("Error");
    expect(errorEvent!.data.error_message).toBe("Error object");

    tracker.stop();
  });

  // ---------- API wrapping ----------

  it("captures errors in setTimeout callbacks when wrapBrowserApis is enabled", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(async (body: string) => Result.ok(new Response(body, { status: 200 })));

    // Reset static guard
    (EventTracker as any)._apiWrappingPatched = false;

    const tracker = new EventTracker({
      projectId: "project-id",
      getAccessToken: async () => "access-token",
      sendBatch,
    }, {
      wrapBrowserApis: true,
    });

    tracker.start();
    await flushTimersAndMicrotasks();
    tracker.clearBuffer();
    sendBatch.mockClear();

    const error = new Error("setTimeout error");
    expect(() => {
      setTimeout(() => {
        throw error;
      }, 100);
      vi.advanceTimersByTime(200);
    }).toThrow("setTimeout error");

    await flushTimersAndMicrotasks();

    const payload = JSON.parse(sendBatch.mock.calls[0]![0] as string) as { events: Array<{ event_type: string, data: Record<string, unknown> }> };
    const errorEvent = payload.events.find((e) => e.event_type === "$error" && e.data.source === "api-wrap:setTimeout");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error_message).toBe("setTimeout error");

    tracker.stop();
  });
});
