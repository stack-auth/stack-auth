// @vitest-environment jsdom

import { KnownErrors } from "@hexclave/shared/dist/known-errors";
import { generateW3cSpanId, generateW3cTraceId, isW3cSpanId, isW3cTraceId, parseTraceparent, uuidToW3cSpanId } from "@hexclave/shared/dist/utils/analytics-wire";
import { Result } from "@hexclave/shared/dist/utils/results";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventTracker, withSpanImpl } from "./event-tracker";
import { HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP } from "./network-capture";
import { decodeSpanContextHeader, installFetchSpanPropagation, TRACEPARENT_HEADER } from "./span-propagation";
import { setAsyncContextModeForTesting } from "./span-context-state";

const TEST_RESOURCE = { service: { name: "test-client" } } as const;

async function advancePastFlush() {
  await vi.advanceTimersByTimeAsync(10_000);
  await Promise.resolve();
}

// Every batch from a started tracker also carries system span rows (at least
// the $page-view span); tests about CUSTOM spans filter those out.
function getCustomSpans<T extends { span_type: string }>(payload: { spans?: T[] }): T[] {
  return (payload.spans ?? []).filter((span) => !span.span_type.startsWith("$"));
}

function getSentEventTypes(sentBodies: string[]) {
  const [body] = sentBodies;

  const payload = JSON.parse(body);
  if (typeof payload !== "object" || payload === null || !("events" in payload) || !Array.isArray(payload.events)) {
    throw new Error("Expected analytics batch payload to include an events array.");
  }

  return (payload.events as { event_type: string }[]).map((event) => event.event_type);
}

describe("EventTracker", () => {
  beforeEach(() => {
    setAsyncContextModeForTesting("auto");
  });

  afterEach(() => {
    setAsyncContextModeForTesting("auto");
    vi.useRealTimers();
  });

  it("samples at flush: drops healthy traces and promotes error spans, logs, and events", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      traceSampleRate: 0,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const healthy = tracker.startSpan("healthy-work");
      const healthyEnd = healthy.end();
      await advancePastFlush();
      await healthyEnd;
      expect(sentBodies).toHaveLength(0);

      const failed = tracker.startSpan("failed-work", { data: { error: "boom" } });
      const failedEnd = failed.end();
      await advancePastFlush();
      await failedEnd;

      expect(sentBodies).toHaveLength(1);
      const payload = JSON.parse(sentBodies[0]) as {
        spans?: { span_type: string, trace_id: string }[],
      };
      const spanTypes = payload.spans?.map((span) => span.span_type);
      expect(spanTypes).toContain("$page-view");
      expect(spanTypes).toContain("failed-work");
      expect(new Set(payload.spans?.map((span) => span.trace_id)).size).toBe(1);

      const logDelivery = tracker.trackLogEvent({
        message: "checkout failed",
        level: "error",
      });
      await advancePastFlush();
      await logDelivery;
      expect(sentBodies).toHaveLength(2);
      const logPayload = JSON.parse(sentBodies[1]) as {
        events?: { event_type: string, level?: string }[],
      };
      expect(logPayload.events).toEqual([
        expect.objectContaining({ event_type: "$log", level: "error" }),
      ]);

      tracker.trackErrorEvent({ message: "uncaught checkout failure" });
      await advancePastFlush();
      expect(sentBodies).toHaveLength(3);
      const errorPayload = JSON.parse(sentBodies[2]) as {
        events?: { event_type: string }[],
      };
      expect(errorPayload.events).toEqual([
        expect.objectContaining({ event_type: "$error" }),
      ]);
    } finally {
      tracker.stop();
    }
  });

  // The headline shape: ONE page visit is ONE trace. Before this, a page view
  // scattered into a near-empty page-view trace plus one trace per fetch per
  // custom span, with nothing but a correlation column tying them together —
  // which made cross-tier links unreadable, because the backend spans hung off
  // whichever isolated fetch trace happened to trigger them.
  it("puts a page view, its events, its custom spans and its fetches in ONE trace", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Buy</button>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const custom = tracker.startSpan("checkout");
      const fetchSpan = tracker.beginHttpRequestSpan({ url: "https://api.example.com/orders", method: "POST", transport: "fetch" });
      fetchSpan?.end({ status: 200, errored: false, aborted: false, propagated: true });
      custom.end().catch(() => {});
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, trace_id?: string }[],
        spans: { span_type: string, trace_id: string, span_id: string, parent_span_id: string | null }[],
      };
      const pageView = payload.spans.find((span) => span.span_type === "$page-view")!;
      expect(pageView.parent_span_id).toBeNull();

      const byType = new Map(payload.spans.map((span) => [span.span_type, span]));
      for (const spanType of ["checkout", "$http-client"]) {
        const span = byType.get(spanType)!;
        expect(span.trace_id).toBe(pageView.trace_id);
        expect(span.parent_span_id).toBe(pageView.span_id);
      }
      expect(payload.events.find((event) => event.event_type === "$click")!.trace_id).toBe(pageView.trace_id);
      // …and the page view is the ONLY root, so the traces list shows one entry.
      expect(payload.spans.filter((span) => span.parent_span_id === null)).toHaveLength(1);
    } finally {
      tracker.stop();
    }
  });

  it("keeps early pages under the refresh root, then uses the replay segment only after it materializes", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const traceId = "12345678123441238123123456789abc";
    const refreshSpanId = "8123123456789abc";
    const segmentId = "aaaaaaaa-aaaa-4aaa-8bbb-bbbbbbbbbbbb";
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sessionRootContext: { traceId, spanId: refreshSpanId },
      sessionReplayEnabled: true,
      sessionReplaySegmentId: segmentId,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const earlyPageId = tracker.getCurrentPageViewSpanId();
      await advancePastFlush();

      tracker.markSessionReplaySegmentMaterialized(segmentId, { traceId, spanId: refreshSpanId });
      const replayPageId = tracker.getCurrentPageViewSpanId();
      expect(replayPageId).not.toBe(earlyPageId);
      const request = tracker.beginHttpRequestSpan({ url: "https://api.example.com/orders", method: "POST", transport: "fetch" });
      request?.end({ status: 200, errored: false, aborted: false, propagated: true });
      await advancePastFlush();

      const spans = sentBodies.flatMap((body) => (JSON.parse(body) as {
        spans: { span_type: string, trace_id: string, span_id: string, parent_span_id: string | null }[],
      }).spans);
      const earlyPage = spans.find((span) => span.span_id === earlyPageId);
      const replayPage = spans.find((span) => span.span_id === replayPageId);
      const http = spans.find((span) => span.span_type === "$http-client");
      expect(earlyPage).toEqual(expect.objectContaining({
        trace_id: traceId,
        parent_span_id: refreshSpanId,
      }));
      expect(replayPage).toEqual(expect.objectContaining({
        trace_id: traceId,
        parent_span_id: uuidToW3cSpanId(segmentId),
      }));
      expect(http).toEqual(expect.objectContaining({
        trace_id: traceId,
        parent_span_id: replayPage?.span_id,
      }));
    } finally {
      tracker.stop();
    }
  });

  it("ignores stale segment acknowledgements and restarts the page when the refresh root changes", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const oldRoot = { traceId: "11111111111141118111111111111111", spanId: "8111111111111111" };
    const newRoot = { traceId: "22222222222242228222222222222222", spanId: "8222222222222222" };
    const currentSegment = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sessionRootContext: oldRoot,
      sessionReplayEnabled: true,
      sessionReplaySegmentId: currentSegment,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const initialPageId = tracker.getCurrentPageViewSpanId();
      tracker.markSessionReplaySegmentMaterialized("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", newRoot);
      expect(tracker.getCurrentPageViewSpanId()).toBe(initialPageId);

      tracker.markSessionReplaySegmentMaterialized(currentSegment, newRoot);
      const rotatedPageId = tracker.getCurrentPageViewSpanId();
      expect(rotatedPageId).not.toBe(initialPageId);
      await advancePastFlush();

      const spans = sentBodies.flatMap((body) => (JSON.parse(body) as {
        spans: { span_id: string, trace_id: string, parent_span_id: string | null }[],
      }).spans);
      expect(spans.find((span) => span.span_id === initialPageId)).toEqual(expect.objectContaining({
        trace_id: oldRoot.traceId,
        parent_span_id: oldRoot.spanId,
      }));
      expect(spans.find((span) => span.span_id === rotatedPageId)).toEqual(expect.objectContaining({
        trace_id: newRoot.traceId,
        parent_span_id: uuidToW3cSpanId(currentSegment),
      }));
    } finally {
      tracker.stop();
    }
  });

  // Regression: autocapture used to stamp only `page_view_span_id`, which is a
  // correlation column, so every click/error/console line in a browser session
  // belonged to no trace and could not be found from the traces UI (its span
  // query is `WHERE trace_id = ?`) or from customer SQL.
  it("puts auto-captured events inside the current $page-view span's trace", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Open project</button><form id=\"quiz\"></form>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector("#quiz")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, trace_id?: string, span_id?: string, page_view_span_id?: string }[],
        spans: { span_type: string, trace_id: string, span_id: string }[],
      };
      const pageView = payload.spans.find((span) => span.span_type === "$page-view")!;
      expect(pageView).toBeDefined();
      for (const eventType of ["$click", "$form-submit"]) {
        const event = payload.events.find((candidate) => candidate.event_type === eventType)!;
        expect(event.trace_id).toBe(pageView.trace_id);
        expect(event.span_id).toBe(pageView.span_id);
        // Correlation still rides alongside the hierarchy, unchanged.
        expect(event.page_view_span_id).toBe(pageView.span_id);
      }
    } finally {
      tracker.stop();
    }
  });

  it("captures events when browser globals are exposed as accessor descriptors", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Open project</button>";

    const screenDescriptor = Object.getOwnPropertyDescriptor(window, "screen");
    const historyDescriptor = Object.getOwnPropertyDescriptor(window, "history");
    expect(screenDescriptor?.value).toBeUndefined();
    expect(historyDescriptor?.value).toBeUndefined();
    expect(screenDescriptor?.get).toBeTypeOf("function");
    expect(historyDescriptor?.get).toBeTypeOf("function");

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 12,
        clientY: 34,
      }));

      await advancePastFlush();

      expect(JSON.parse(sentBodies[0])).toMatchObject({
        schema_version: 3,
        resource: TEST_RESOURCE,
      });
      // Dead-click classification marks the buffered $click in place —
      // exactly one click event either way.
      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        [
          "$click",
        ]
      `);
    } finally {
      tracker.stop();
    }
  });

  it("keeps keystroke capture disabled by default", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"shortcut\">Shortcut target</button>";
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("#shortcut")?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "k" }));
      await advancePastFlush();

      expect(getSentEventTypes(sentBodies)).not.toContain("$keystroke");
    } finally {
      tracker.stop();
    }
  });

  it("debounces opted-in keydowns into a count without capturing key values or typed text", async () => {
    vi.useFakeTimers();
    const performanceOriginMs = Date.now();
    const performanceNowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now() - performanceOriginMs);
    document.body.innerHTML = "<input id=\"search\" type=\"text\" value=\"private search\">";
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      keystrokeCapture: { enabled: true, maskAllInputs: false },
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const input = document.querySelector("#search");
      if (input === null) throw new Error("search input missing");
      const startedAtMs = Date.now();
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "s" }));
      await vi.advanceTimersByTimeAsync(200);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "e" }));
      await vi.advanceTimersByTimeAsync(200);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "c" }));

      // Trailing debounce: nothing is buffered until the burst has been idle.
      await vi.advanceTimersByTimeAsync(499);
      await tracker.flush();
      expect(sentBodies).toHaveLength(1);
      expect(getSentEventTypes(sentBodies)).not.toContain("$keystroke");

      await vi.advanceTimersByTimeAsync(1);
      await tracker.flush();

      const events = sentBodies.flatMap((body) => (JSON.parse(body) as {
        events?: { event_type: string, event_at_ms: number, data: Record<string, unknown> }[],
      }).events ?? []);
      const keystrokes = events.filter((event) => event.event_type === "$keystroke");
      expect(keystrokes).toEqual([expect.objectContaining({
        event_at_ms: startedAtMs,
        data: expect.objectContaining({ count: 3, duration_ms: 400 }),
      })]);
      for (const body of sentBodies) {
        expect(body).not.toContain("private search");
        expect(body).not.toContain('"key"');
        expect(body).not.toContain('"code"');
      }
    } finally {
      tracker.stop();
      performanceNowSpy.mockRestore();
    }
  });

  it("excludes masked inputs, password fields, and blocked replay subtrees from keystroke counts", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <input id="masked" type="text">
      <input id="password" type="password">
      <div class="rr-mask" contenteditable="true" id="masked-text">hidden</div>
      <div class="private"><button id="blocked">Blocked</button></div>
      <button id="visible">Visible shortcut</button>
    `;
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      keystrokeCapture: {
        enabled: true,
        maskAllInputs: true,
        blockSelector: ".private",
      },
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      for (const selector of ["#masked", "#password", "#masked-text", "#blocked", "#visible"]) {
        document.querySelector(selector)?.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          key: "x",
        }));
      }
      await vi.advanceTimersByTimeAsync(500);
      await tracker.flush();

      const events = sentBodies.flatMap((body) => (JSON.parse(body) as {
        events?: { event_type: string, data: Record<string, unknown> }[],
      }).events ?? []);
      expect(events.filter((event) => event.event_type === "$keystroke")).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ count: 1 }) }),
      ]);
    } finally {
      tracker.stop();
    }
  });

  it("emits a PostHog-style elements_chain plus scaled pointer coords for $click", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <section class="card panel">
          <button id="save-btn" data-testid="save" aria-label="Save project">Save changes</button>
        </section>
      </main>
    `;

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const button = document.querySelector("#save-btn");
      if (button == null) throw new Error("button missing");
      button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 100,
        clientY: 200,
      }));

      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, data: Record<string, unknown> }[] };
      const click = payload.events.find((event) => event.event_type === "$click");
      if (click == null) throw new Error("no $click event captured");

      // elements_chain encodes the target leaf plus a few ancestors. Leaf is
      // first; segments are `;`-delimited. Assert against substrings rather
      // than the full string so jsdom layout quirks don't make this flaky.
      const chain = click.data.elements_chain;
      expect(typeof chain).toBe("string");
      expect(chain).toContain('button');
      expect(chain).toContain('attr__id="save-btn"');
      expect(chain).toContain('attr__data-testid="save"');
      expect(chain).toContain('attr__aria-label="Save project"');
      expect(chain).toContain('text="Save changes"');
      // Ancestor section is in the chain too.
      expect(chain).toContain("section");

      // Pre-scaled coords land in clickmap_events.pointer_*. SCALE_FACTOR=16.
      expect(click.data.x_scaled).toBe(Math.round(100 / 16));
      expect(click.data.y_scaled).toBe(Math.round(200 / 16));
      expect(click.data.client_y_scaled).toBe(Math.round(200 / 16));
      expect(click.data.scale_factor).toBe(16);
      expect(click.data.pointer_relative_x).toBeCloseTo(100 / window.innerWidth, 4);
      expect(click.data.pointer_target_fixed).toBe(0);

      // Legacy CSS selector still emitted for back-compat. The builder prefers
      // data-testid over id, so we assert against that anchor rather than #id.
      expect(click.data.selector).toContain('data-testid="save"');
      expect(click.data.tag_name).toBe("button");
    } finally {
      tracker.stop();
    }
  });

  it("ignores clicks inside the Hexclave dev tool", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="__hexclave-dev-tool-root">
        <button>Clickmap toolbar control</button>
      </div>
    `;

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 100,
        clientY: 200,
      }));

      await advancePastFlush();

      // Dev-tool clicks are ignored; page views are span-only so the events
      // array is empty (the batch still carries the $page-view span).
      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        []
      `);
    } finally {
      tracker.stop();
    }
  });

  it("flags pointer_target_fixed when the target sits under a fixed-position ancestor", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <header style="position: fixed; top: 0">
        <button id="cta">Sign up</button>
      </header>
    `;

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      document.querySelector("#cta")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, data: Record<string, unknown> }[] };
      const click = payload.events.find((event) => event.event_type === "$click");
      expect(click?.data.pointer_target_fixed).toBe(1);
    } finally {
      tracker.stop();
    }
  });

  it("flags a click with no observable effect as dead on its single $click event", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"dead\">Does nothing</button>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const clickAtMs = Date.now();
      document.querySelector("#dead")?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 10,
        clientY: 20,
      }));

      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, event_at_ms: number, data: Record<string, unknown> }[] };
      const clicks = payload.events.filter((event) => event.event_type === "$click");
      expect(clicks).toHaveLength(1);
      const click = clicks[0];

      // One event per physical click: the buffered $click is marked dead in
      // place, still timestamped at the original click rather than at
      // classification time (~3s later).
      expect(click.data.dead).toBe(1);
      expect(click.event_at_ms).toBe(clickAtMs);
    } finally {
      tracker.stop();
    }
  });

  it("does not flag a click as dead when it mutates the DOM", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"live\">Adds content</button><div id=\"out\"></div>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const button = document.querySelector("#live");
      if (button == null) throw new Error("button missing");
      button.addEventListener("click", () => {
        document.querySelector("#out")?.appendChild(document.createElement("p"));
      });
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Let the MutationObserver microtask run so the mutation is recorded
      // before the dead-click sweeps start.
      await Promise.resolve();

      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, data: Record<string, unknown> }[] };
      const clicks = payload.events.filter((event) => event.event_type === "$click");
      expect(clicks).toHaveLength(1);
      expect(clicks[0].data.dead).toBeUndefined();
    } finally {
      tracker.stop();
    }
  });

  it("drains held clicks as alive on pagehide so navigation clicks are never lost", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<a id=\"nav\" href=\"/pricing\">Pricing</a>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const clickAtMs = Date.now();
      document.querySelector("#nav")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      // Navigation fires pagehide well before any classification sweep — the
      // keepalive flush ships the still-unclassified click as a plain (alive)
      // $click.
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
      await Promise.resolve();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, event_at_ms: number, data: Record<string, unknown> }[] };
      const clicks = payload.events.filter((event) => event.event_type === "$click");
      expect(clicks).toHaveLength(1);
      expect(clicks[0].data.dead).toBeUndefined();
      expect(clicks[0].event_at_ms).toBe(clickAtMs);
    } finally {
      tracker.stop();
    }
  });

  it("holds an unclassified click out of a flush and ships it on the next one", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"late\">Late click</button>";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      // Click 500ms before the 10s flush tick: classification cannot finish
      // in time, so the flush must hold the click back rather than send it
      // unclassified.
      await vi.advanceTimersByTimeAsync(9_500);
      document.querySelector("#late")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);

      // First flush ships only the $page-view span (no events yet — the click
      // is held for dead-click classification).
      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        []
      `);

      // By the next flush the sweep has classified it (dead — nothing
      // observable happened) and it ships marked.
      await vi.advanceTimersByTimeAsync(10_000);
      const second = JSON.parse(sentBodies[1] ?? "{}") as { events: { event_type: string, data: Record<string, unknown> }[] };
      expect(second.events.map((event) => event.event_type)).toMatchInlineSnapshot(`
        [
          "$click",
        ]
      `);
      expect(second.events[0].data.dead).toBe(1);
    } finally {
      tracker.stop();
    }
  });

  it("captures client-side navigations when history is exposed as an accessor descriptor", async () => {
    vi.useFakeTimers();

    const historyDescriptor = Object.getOwnPropertyDescriptor(window, "history");
    expect(historyDescriptor?.value).toBeUndefined();
    expect(historyDescriptor?.get).toBeTypeOf("function");

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      window.history.pushState({}, "", "/projects/test-project");

      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_type: string, data: { entry_type?: string } }[] };
      const pageViewSpans = (payload.spans ?? []).filter((span) => span.span_type === "$page-view");
      expect(pageViewSpans.map((span) => span.data.entry_type)).toEqual(["initial", "push"]);
      expect(getSentEventTypes(sentBodies)).toEqual([]);
    } finally {
      tracker.stop();
    }
  });

  it("silently ignores network errors caused by ad blockers", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Click me</button>";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.error(new TypeError("Failed to fetch"));
      },
    });

    try {
      tracker.start();

      await advancePastFlush();
      expect(sentBodies).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();

      // Unlike ANALYTICS_NOT_ENABLED, ad blocker errors do NOT disable the
      // tracker — subsequent flushes continue attempting delivery.
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await advancePastFlush();
      expect(sentBodies).toHaveLength(2);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      tracker.stop();
      warnSpy.mockRestore();
    }
  });

  it("buffers custom events alongside system events and resolves their promises on ack", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "";

    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const promise = tracker.trackCustomEvent("checkout_completed", { cart_size: 3 });

      await advancePastFlush();
      await expect(promise).resolves.toBeUndefined();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, data: Record<string, unknown>, trace_id?: string, span_id?: string }[],
        spans?: { span_type: string, trace_id: string, span_id: string }[],
      };
      expect(payload.events.map((event) => event.event_type)).toEqual(["checkout_completed"]);
      const custom = payload.events[0];
      expect(custom.data).toEqual({ cart_size: 3 });
      // No parent given and no globals set, so the event falls back to the
      // current `$page-view` span: an event is only ever findable through its
      // trace, and the page view is the operation it happened inside. It still
      // never MINTS a trace — a fabricated trace id would show up in the trace
      // inbox as a phantom root.
      const pageView = payload.spans?.find((span) => span.span_type === "$page-view");
      expect(custom.span_id).toBe(pageView?.span_id);
      expect(custom.trace_id).toBe(pageView?.trace_id);
      expect(custom.span_id).toBe(tracker.getCurrentPageViewSpanId());
    } finally {
      tracker.stop();
    }
  });

  it("rejects invalid events and throws for invalid spans", async () => {
    vi.useFakeTimers();
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async () => Result.ok(new Response()),
    });

    try {
      tracker.start();
      // $-prefixed names are reserved for system telemetry.
      await expect(tracker.trackCustomEvent("$page-view")).rejects.toThrow(/reserved for system telemetry/);
      await expect(tracker.trackCustomEvent("1-starts-with-digit")).rejects.toThrow(/must start with a letter/);
      await expect(tracker.trackCustomEvent("x".repeat(65))).rejects.toThrow(/at most 64 characters/);
      await expect(tracker.trackCustomEvent("ok", [1, 2] as any)).rejects.toThrow(/plain JSON-serializable object/);
      await expect(tracker.trackCustomEvent("ok", { big: "x".repeat(64_001) })).rejects.toThrow(/at most 64000 bytes/);
      await expect(tracker.trackCustomEvent("ok", { big: "é".repeat(32_001) })).rejects.toThrow(/at most 64000 bytes/);
      // Parent ids are now W3C, so the validation message is about hex shape.
      await expect(tracker.trackCustomEvent("ok", {}, { parent: { traceId: "not-a-trace", spanId: "1111111111111111" } })).rejects.toThrow(/must be 32 lowercase hex characters and not all-zero/);
      await expect(tracker.trackCustomEvent("ok", {}, { parent: { traceId: "0".repeat(32), spanId: "1111111111111111" } })).rejects.toThrow(/not all-zero/);
      await expect(tracker.trackCustomEvent("ok", {}, { parent: { traceId: "a".repeat(32), spanId: "0".repeat(16) } })).rejects.toThrow(/must be 16 lowercase hex characters and not all-zero/);
      await expect(tracker.trackCustomEvent("ok", {}, { links: [{ traceId: "a".repeat(32), spanId: "nope" }] })).rejects.toThrow(/Invalid link spanId/);

      expect(() => tracker.startSpan("$reserved")).toThrow(/reserved for system telemetry/);

      // Nothing invalid was buffered.
      await advancePastFlush();
    } finally {
      tracker.stop();
    }
  });

  it("writes a span open on start, dedupes in-batch re-writes to the latest row, and settles every promise", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const span = tracker.startSpan("checkout-flow", { data: { cart_size: 3 } });
      const setDataPromise = span.setData({ coupon: "SAVE10" });
      const endPromise = span.end();
      expect(span.isEnded).toBe(true);
      // end() is idempotent: repeat calls return the first call's promise.
      expect(span.end()).toBe(endPromise);

      await advancePastFlush();
      await expect(setDataPromise).resolves.toBeUndefined();
      await expect(endPromise).resolves.toBeUndefined();

      // Start + setData + end within one flush window: exactly ONE wire row,
      // carrying the latest state (ended, merged data).
      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { trace_id: string, span_id: string, span_type: string, ended_at_ms: number | null, data: Record<string, unknown>, parent_span_id: string | null }[] };
      const customSpans = getCustomSpans(payload);
      expect(customSpans).toHaveLength(1);
      const row = customSpans[0];
      expect(row.span_id).toBe(span.spanId);
      expect(row.trace_id).toBe(span.traceId);
      expect(row.span_type).toBe("checkout-flow");
      expect(row.ended_at_ms).not.toBeNull();
      expect(row.data).toEqual({ cart_size: 3, coupon: "SAVE10" });
      // No enclosing custom context, so the page view encloses it — the span
      // lands in the trace of the page it was started on rather than minting a
      // top-level trace of its own.
      expect(row.parent_span_id).toBe(tracker.getCurrentPageViewSpanId());
      expect(isW3cTraceId(row.trace_id)).toBe(true);
      expect(isW3cSpanId(row.span_id)).toBe(true);
    } finally {
      tracker.stop();
    }
  });

  it("rejects an invalid endedAtMs instead of fabricating a timestamp", () => {
    vi.useFakeTimers();
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async () => Result.ok(new Response()),
    });

    try {
      tracker.start();
      const span = tracker.startSpan("checkout-flow");
      expect(() => span.end({ endedAtMs: Number.NaN })).toThrow(/non-negative integer/);
      expect(span.isEnded).toBe(false);
    } finally {
      tracker.stop();
    }
  });

  it("re-writes a span across flushes with a strictly increasing version", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const span = tracker.startSpan("upload");
      await advancePastFlush();

      span.end().catch(() => {});
      await advancePastFlush();

      const first = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_type: string, ended_at_ms: number | null, updated_at_ms: number }[] };
      const second = JSON.parse(sentBodies[1] ?? "{}") as { spans?: { span_type: string, ended_at_ms: number | null, updated_at_ms: number }[] };
      expect(getCustomSpans(first)[0].ended_at_ms).toBeNull();
      expect(getCustomSpans(second)[0].ended_at_ms).not.toBeNull();
      // The end row must always beat the open row in the ReplacingMergeTree,
      // even if the batches arrive out of order server-side.
      expect(getCustomSpans(second)[0].updated_at_ms).toBeGreaterThan(getCustomSpans(first)[0].updated_at_ms);
    } finally {
      tracker.stop();
    }
  });

  it("parents children and events under the nearest ambient span (global span, then handle)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const checkout = tracker.startSpan("checkout-flow");
      tracker.setGlobalSpan(checkout);

      // Child created via the handle: its parent is the handle, exactly.
      const payment = checkout.startSpan("payment-step");
      // Event tracked via the child handle: the handle pins ITSELF as parent, so
      // `payment` wins over the ambient global span — a span has one parent, and
      // handle-based nesting is exact where ambient context is only a guess.
      const eventPromise = payment.trackEvent("card_declined", { code: "51" });

      // A serialized context explicitly overrides ambient entirely.
      const explicit = { traceId: generateW3cTraceId(), spanId: generateW3cSpanId() };
      tracker.trackCustomEvent("hint_shown", {}, { parent: explicit }).catch(() => {});

      await advancePastFlush();
      await expect(eventPromise).resolves.toBeUndefined();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, trace_id?: string, span_id?: string }[],
        spans?: { trace_id: string, span_id: string, parent_span_id: string | null }[],
      };
      const paymentRow = payload.spans!.find((row) => row.span_id === payment.spanId)!;
      expect(paymentRow.parent_span_id).toBe(checkout.spanId);
      expect(paymentRow.trace_id).toBe(checkout.traceId);

      const declined = payload.events.find((event) => event.event_type === "card_declined")!;
      expect(declined.span_id).toBe(payment.spanId);
      expect(declined.trace_id).toBe(checkout.traceId);

      const hint = payload.events.find((event) => event.event_type === "hint_shown")!;
      expect(hint.span_id).toBe(explicit.spanId);
      expect(hint.trace_id).toBe(explicit.traceId);

      // Ending a global span auto-unsets it: subsequent events fall back to the
      // page view rather than staying attached to the ended span. They stay in
      // the same TRACE, because the global span was itself started on this page
      // and therefore already lived in the page view's trace.
      checkout.end().catch(() => {});
      tracker.trackCustomEvent("after_end").catch(() => {});
      await advancePastFlush();
      const second = JSON.parse(sentBodies[1] ?? "{}") as { events: { event_type: string, trace_id?: string, span_id?: string }[] };
      const after = second.events.find((event) => event.event_type === "after_end")!;
      expect(after.span_id).not.toBe(checkout.spanId);
      expect(after.span_id).toBe(tracker.getCurrentPageViewSpanId());
      expect(after.trace_id).toBe(checkout.traceId);
    } finally {
      tracker.stop();
    }
  });

  it("two global spans in different traces: the NEAREST is the parent, the other becomes a link", async () => {
    // Replaces the old "reject sibling global spans" rule. Flattening two
    // unrelated spans into one ancestry path was a lie, so the old model refused
    // outright; a scalar parent has no such problem — the loser is simply not an
    // ancestor, and `links` is the standard way to say "causally related, not my
    // parent". Registering a second global span is therefore legal now.
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      sessionReplaySegmentId: "segment",
    });

    try {
      tracker.start();
      const left = tracker.startSpan("left", { root: true });
      const right = tracker.startSpan("right", { root: true });
      expect(left.traceId).not.toBe(right.traceId);
      tracker.setGlobalSpan(left);
      tracker.setGlobalSpan(right);

      const child = tracker.startSpan("child");
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        spans?: { span_type: string, trace_id: string, span_id: string, parent_span_id: string | null, links?: { trace_id: string, span_id: string }[] }[],
      };
      const childRow = getCustomSpans(payload).find((row) => row.span_id === child.spanId)!;
      // Ambient contexts are ordered outermost-first, so the LAST registered
      // global span is the nearest and wins the single parent slot.
      expect(childRow.parent_span_id).toBe(right.spanId);
      expect(childRow.trace_id).toBe(right.traceId);
      // `left` is provably NOT an ancestor (different trace), so it is demoted
      // to a link rather than silently dropped.
      expect(childRow.links).toEqual([{ trace_id: left.traceId, span_id: left.spanId }]);
    } finally {
      tracker.stop();
    }
  });

  it("continues a trace from a serialized SpanContext handed over from another tier", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      // Simulates a span minted on another tier (e.g. the server, via page
      // props) and passed through JSON. A bare span id would be useless here —
      // a span id only identifies a span WITHIN its trace — which is why the
      // serializable currency is the {traceId, spanId} pair.
      const serverSpan = { traceId: generateW3cTraceId(), spanId: generateW3cSpanId() };
      const child = tracker.startSpan("client-continuation", { parent: serverSpan });
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null }[] };
      const customSpans = getCustomSpans(payload);
      expect(customSpans[0].span_id).toBe(child.spanId);
      expect(customSpans[0].parent_span_id).toBe(serverSpan.spanId);
      // Joining the server's TRACE is the whole point: same trace id, new span.
      expect(customSpans[0].trace_id).toBe(serverSpan.traceId);
      expect(child.spanContext()).toEqual({ traceId: serverSpan.traceId, spanId: child.spanId });
    } finally {
      tracker.stop();
    }
  });

  it("rejects pending promises on failed sends without unhandled rejections, and flush() sends immediately", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let failNext = true;
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return failNext ? Result.error(new TypeError("Failed to fetch")) : Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const failed = tracker.trackCustomEvent("will_fail");
      // flush() is the "send now" escape hatch — no timer advance needed.
      await tracker.flush();
      expect(sentBodies).toHaveLength(1);
      await expect(failed).rejects.toThrow("Failed to fetch");

      failNext = false;
      const succeeded = tracker.trackCustomEvent("will_succeed");
      await tracker.flush();
      await expect(succeeded).resolves.toBeUndefined();
    } finally {
      tracker.stop();
      warnSpy.mockRestore();
    }
  });

  it("clearBuffer drops pending telemetry and inert-ifies live spans (sign-out privacy)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const span = tracker.startSpan("cross-user-flow");
      const pendingEvent = tracker.trackCustomEvent("pre_signout");

      tracker.clearBuffer();
      await expect(pendingEvent).rejects.toThrow(/buffer cleared/);

      // A post-clear end() must not write anything: the handle is inert, so a
      // span started by user A can never be re-written under user B.
      await expect(span.end()).resolves.toBeUndefined();
      await advancePastFlush();

      for (const body of sentBodies) {
        const payload = JSON.parse(body) as { events?: { event_type: string }[], spans?: unknown[] };
        // clearBuffer inert-ifies open handles; nothing custom may ship after.
        expect(payload.spans).toBeUndefined();
        expect(payload.events ?? []).toEqual([]);
      }
    } finally {
      tracker.stop();
    }
  });

  it("ships buffered spans on the keepalive pagehide flush (open spans stay open)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      tracker.startSpan("abandoned-flow");
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
      await Promise.resolve();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_type: string, ended_at_ms: number | null }[] };
      const customSpans = getCustomSpans(payload);
      expect(customSpans).toHaveLength(1);
      expect(customSpans[0].span_type).toBe("abandoned-flow");
      // No auto-end on unload: the span survives as an open interval by design.
      expect(customSpans[0].ended_at_ms).toBeNull();
      // The $page-view span, by contrast, IS closed by pagehide — its interval
      // is the time-on-page.
      const pageViewSpan = (payload.spans ?? []).find((span) => span.span_type === "$page-view");
      expect(pageViewSpan?.ended_at_ms).toBeTypeOf("number");
    } finally {
      tracker.stop();
    }
  });

  it("withSpan auto-ends the span and ambient-parents everything created inside", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    let innerSpanId = "";
    const result = await withSpanImpl(
      (type, options) => tracker.startSpan(type, options),
      "outer-flow",
      async (outer) => {
        expect(outer.isEnded).toBe(false);
        const inner = tracker.startSpan("inner-step");   // ambient parent: outer
        innerSpanId = inner.spanId;
        tracker.trackCustomEvent("inner_event").catch(() => {});  // ambient parent: outer
        inner.end().catch(() => {});
        return 42;
      },
    );
    expect(result).toBe(42);

    await tracker.flush();
    const payload = JSON.parse(sentBodies[0] ?? "{}") as {
      events: { event_type: string, trace_id?: string, span_id?: string }[],
      spans?: { trace_id: string, span_id: string, span_type: string, ended_at_ms: number | null, parent_span_id: string | null }[],
    };
    const outerRow = payload.spans!.find((row) => row.span_type === "outer-flow")!;
    expect(outerRow.ended_at_ms).not.toBeNull();     // auto-ended on settle
    expect(outerRow.parent_span_id).toBeNull();      // its own parent comes from the ENCLOSING context
    const innerRow = payload.spans!.find((row) => row.span_id === innerSpanId)!;
    expect(innerRow.parent_span_id).toBe(outerRow.span_id);
    expect(innerRow.trace_id).toBe(outerRow.trace_id);
    const innerEvent = payload.events.find((event) => event.event_type === "inner_event")!;
    expect(innerEvent.span_id).toBe(outerRow.span_id);
    expect(innerEvent.trace_id).toBe(outerRow.trace_id);

    // The frame is gone after withSpan settles: no ambient parent here.
    tracker.trackCustomEvent("after_frame").catch(() => {});
    await tracker.flush();
    const second = JSON.parse(sentBodies[1] ?? "{}") as { events: { event_type: string, trace_id?: string, span_id?: string }[] };
    const afterFrame = second.events.find((event) => event.event_type === "after_frame")!;
    expect(afterFrame.trace_id).toBeUndefined();
    expect(afterFrame.span_id).toBeUndefined();
  });

  it("withSpan records data.error, ends the span, and rethrows on failure", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    await expect(withSpanImpl(
      (type, options) => tracker.startSpan(type, options),
      "failing-flow",
      async () => {
        throw new Error("boom");
      },
    )).rejects.toThrow("boom");

    await tracker.flush();
    const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_type: string, ended_at_ms: number | null, data: Record<string, unknown> }[] };
    const row = payload.spans!.find((entry) => entry.span_type === "failing-flow")!;
    expect(row.ended_at_ms).not.toBeNull();
    expect(row.data).toEqual({ error: "boom" });
  });

  it("root:true starts a NEW trace, while a sibling without it stays in the enclosing one", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    let outerTraceId = "";
    let detachedTraceId = "";
    await withSpanImpl(
      (type, options) => tracker.startSpan(type, options),
      "outer",
      async (outer) => {
        outerTraceId = outer.traceId;
        const detached = tracker.startSpan("detached", { root: true });
        detachedTraceId = detached.traceId;
        // `root` drops the AMBIENT parent, which under W3C also means leaving
        // the trace: a root activity by definition begins its own trace.
        expect(detached.spanContext()).toEqual({ traceId: detachedTraceId, spanId: detached.spanId });
        expect(detachedTraceId).not.toBe(outerTraceId);

        const child = tracker.startSpan("child");   // ambient parent: outer
        // An explicit parent overrides ambient entirely, so this event hangs off
        // `child` and not off the enclosing `outer` frame.
        tracker.trackCustomEvent("evt", {}, { parent: child }).catch(() => {});
        child.end().catch(() => {});
        detached.end().catch(() => {});
      },
    );

    await tracker.flush();
    const payload = JSON.parse(sentBodies[0] ?? "{}") as {
      events: { event_type: string, trace_id?: string, span_id?: string }[],
      spans?: { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null }[],
    };
    const outerRow = payload.spans!.find((row) => row.span_type === "outer")!;
    const childRow = payload.spans!.find((row) => row.span_type === "child")!;
    const detachedRow = payload.spans!.find((row) => row.span_type === "detached")!;
    expect(detachedRow.parent_span_id).toBeNull();
    expect(detachedRow.trace_id).toBe(detachedTraceId);
    expect(isW3cTraceId(detachedRow.trace_id)).toBe(true);
    expect(childRow.parent_span_id).toBe(outerRow.span_id);
    expect(childRow.trace_id).toBe(outerTraceId);
    const evt = payload.events.find((event) => event.event_type === "evt")!;
    expect(evt.span_id).toBe(childRow.span_id);
    expect(evt.trace_id).toBe(outerTraceId);
  });

  it("passes every batch-send promise to registerBackgroundTask (waitUntil hook)", async () => {
    const registered: Promise<unknown>[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async () => Result.ok(new Response()),
      registerBackgroundTask: (promise) => registered.push(promise),
    });

    tracker.trackCustomEvent("first").catch(() => {});
    await tracker.flush();
    tracker.trackCustomEvent("second").catch(() => {});
    await tracker.flush();

    expect(registered).toHaveLength(2);
    await expect(Promise.all(registered)).resolves.toBeDefined();
  });

  it("isolates registerBackgroundTask hook failures from flush delivery", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async () => Result.ok(new Response()),
      registerBackgroundTask: () => {
        throw new Error("waitUntil unavailable");
      },
    });

    try {
      tracker.trackCustomEvent("first").catch(() => {});

      await expect(tracker.flush()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        "Hexclave analytics: EventTracker waitUntil hook failed:",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stops autocapture but rejects explicit telemetry after ANALYTICS_NOT_ENABLED", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Click me</button>";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.error(new KnownErrors.AnalyticsNotEnabled());
      },
    });

    try {
      tracker.start();

      await advancePastFlush();
      expect(sentBodies).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect((tracker as any)._flushTimer).toBeNull();

      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await advancePastFlush();
      expect(sentBodies).toHaveLength(1);
      await expect(tracker.trackCustomEvent("checkout")).rejects.toThrow(/telemetry is disabled/);
      expect(() => tracker.startSpan("checkout")).toThrow(/telemetry is disabled/);
    } finally {
      tracker.stop();
      warnSpy.mockRestore();
    }
  });
});

describe("EventTracker ambient modes + span handle kit", () => {
  const SEG = "11111111-1111-4111-8111-111111111111";

  function makeTracker(sentBodies: string[], extraDeps?: Partial<import("./event-tracker").EventTrackerDeps>) {
    return new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      sessionReplaySegmentId: SEG,
      ...extraDeps,
    });
  }

  afterEach(() => {
    setAsyncContextModeForTesting("auto");
    vi.useRealTimers();
  });

  it("ambient parenting drops suspended sync frames after await (exact-only)", async () => {
    setAsyncContextModeForTesting("sync-stack");
    vi.useFakeTimers();

    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      let spanId!: string;
      await withSpanImpl((type, opts) => tracker.startSpan(type, opts), "flow", async (span) => {
        spanId = span.spanId;
        // Synchronous prologue: provably this flow — ambient.
        tracker.trackCustomEvent("in_prologue").catch(() => {});
        await Promise.resolve();
        // Post-await on the browser fallback: ambient stops; use span.run / trackEvent.
        tracker.trackCustomEvent("post_await").catch(() => {});
      });
      await advancePastFlush();
      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, trace_id?: string, span_id?: string }[] };
      const prologue = payload.events.find((event) => event.event_type === "in_prologue");
      const postAwait = payload.events.find((event) => event.event_type === "post_await");
      expect(prologue?.span_id).toBe(spanId);
      // Fails CLOSED after the await: the suspended frame is NOT reused. What
      // remains is the page-view fallback (the one enclosing span that is always
      // provably current), never a guess at the flow's own span.
      expect(postAwait?.span_id).not.toBe(spanId);
      expect(postAwait?.span_id).toBe(tracker.getCurrentPageViewSpanId());
    } finally {
      tracker.stop();
    }
  });

  it("span.withSpan nests exactly under the handle and auto-ends the child", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const parent = tracker.startSpan("outer");
      await parent.withSpan("inner", async (child) => {
        expect(child.spanType).toBe("inner");
        child.trackEvent("evt").catch(() => {});
      });
      await advancePastFlush();
      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, trace_id?: string, span_id?: string }[],
        spans: { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null, ended_at_ms: number | null }[],
      };
      const inner = payload.spans.find((row) => row.span_type === "inner")!;
      expect(inner.parent_span_id).toBe(parent.spanId);
      expect(inner.trace_id).toBe(parent.traceId);
      expect(inner.ended_at_ms).not.toBeNull();
      const evt = payload.events.find((event) => event.event_type === "evt")!;
      // `child.trackEvent` pins the CHILD, not the whole chain — the child handle
      // is the exact enclosing span.
      expect(evt.span_id).toBe(inner.span_id);
      expect(evt.trace_id).toBe(parent.traceId);
    } finally {
      tracker.stop();
    }
  });

  it("span.run re-binds the span for a callback's window", async () => {
    setAsyncContextModeForTesting("sync-stack");
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const span = tracker.startSpan("flow");
      // e.g. a third-party callback, far from any withSpan prologue:
      await span.run(() => {
        tracker.trackCustomEvent("from_callback").catch(() => {});
      });
      await advancePastFlush();
      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, trace_id?: string, span_id?: string }[] };
      const evt = payload.events.find((event) => event.event_type === "from_callback")!;
      expect(evt.span_id).toBe(span.spanId);
      expect(evt.trace_id).toBe(span.traceId);
    } finally {
      tracker.stop();
    }
  });

  it("span.getSpanPropagationHeaders pins traceparent to exactly this span, and correlation to the segment", () => {
    const tracker = makeTracker([]);
    const parent = tracker.startSpan("outer");
    const child = parent.startSpan("inner");
    const headers = child.getSpanPropagationHeaders();
    // HIERARCHY: exactly this span, sampled — an explicitly pinned custom span is
    // always stored, unlike an auto-captured fetch that may be sampled out.
    expect(parseTraceparent(headers[TRACEPARENT_HEADER])).toEqual({
      traceId: child.traceId,
      spanId: child.spanId,
      sampled: true,
    });
    // CORRELATION: no span ids of ours in here any more, only the tab identity.
    expect(decodeSpanContextHeader(headers["x-hexclave-span-context"])).toEqual({
      projectId: "internal",
      sessionReplaySegmentId: SEG,
    });
  });

  it("does not advertise a manually pinned span from a head-dropped trace", () => {
    const tracker = makeTracker([], { traceSampleRate: 0 });
    const span = tracker.startSpan("head-dropped");

    const headers = span.getSpanPropagationHeaders();
    expect(headers[TRACEPARENT_HEADER]).toBeUndefined();
    expect(decodeSpanContextHeader(headers["x-hexclave-span-context"])).toEqual({
      projectId: "internal",
      sessionReplaySegmentId: SEG,
    });
  });

  it("span.getSpanPropagationHeaders carries the span's FROZEN page ancestry once the tracker runs", async () => {
    vi.useFakeTimers();
    const tracker = makeTracker([]);
    try {
      tracker.start();
      const pageViewSpanId = tracker.getCurrentPageViewSpanId();
      expect(pageViewSpanId).toBeTypeOf("string");
      const span = tracker.startSpan("flow");

      const decoded = decodeSpanContextHeader(span.getSpanPropagationHeaders()["x-hexclave-span-context"]);
      expect(decoded?.pageViewSpanId).toBe(pageViewSpanId);

      // Navigating replaces the current page — but the header stays pinned to
      // the page the span STARTED on (frozen, like the custom chain).
      window.history.pushState({}, "", "/next-page");
      expect(tracker.getCurrentPageViewSpanId()).not.toBe(pageViewSpanId);
      const decodedAfterNav = decodeSpanContextHeader(span.getSpanPropagationHeaders()["x-hexclave-span-context"]);
      expect(decodedAfterNav?.pageViewSpanId).toBe(pageViewSpanId);
    } finally {
      tracker.stop();
    }
  });

  it("span.fetch attaches the pinned header same-origin, skips cross-origin, never clobbers explicit", async () => {
    const calls: { input: unknown, init: RequestInit | undefined }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response();
    }) as typeof fetch;
    try {
      const tracker = makeTracker([]);
      const span = tracker.startSpan("flow");

      await span.fetch("/api/x");
      const attached = new Headers(calls[0].init?.headers);
      // The pinned span rides as `traceparent`; the backend's withSpan({ request })
      // nests under exactly this span, immune to ambient ambiguity.
      expect(parseTraceparent(attached.get(TRACEPARENT_HEADER))).toEqual({
        traceId: span.traceId,
        spanId: span.spanId,
        sampled: true,
      });
      expect(decodeSpanContextHeader(attached.get("x-hexclave-span-context"))).toEqual({
        projectId: "internal",
        sessionReplaySegmentId: SEG,
      });

      await span.fetch("https://third-party.example/x");
      expect(calls[1].init).toBeUndefined();

      // Per-header precedence: a caller who pinned traceparent by hand keeps it,
      // and still gets our correlation header.
      const explicitTraceparent = "00-11111111111111111111111111111111-1111111111111111-01";
      await span.fetch("/api/y", { headers: { [TRACEPARENT_HEADER]: explicitTraceparent } });
      const third = new Headers(calls[2].init?.headers);
      expect(third.get(TRACEPARENT_HEADER)).toBe(explicitTraceparent);
      expect(third.get("x-hexclave-span-context")).not.toBeNull();

      const explicitContext = "v1.explicit-wins";
      await span.fetch("/api/z", { headers: { "x-hexclave-span-context": explicitContext } });
      const fourth = new Headers(calls[3].init?.headers);
      expect(fourth.get("x-hexclave-span-context")).toBe(explicitContext);
      expect(fourth.get(TRACEPARENT_HEADER)).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("EventTracker $page-view span + autocapture", () => {
  function makeTracker(sentBodies: string[], extraDeps?: Partial<import("./event-tracker").EventTrackerDeps>) {
    return new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      ...extraDeps,
    });
  }

  type WireSpan = {
    span_id: string,
    span_type: string,
    started_at_ms: number,
    ended_at_ms: number | null,
    data: Record<string, unknown>,
    page_view_span_id?: string,
  };
  type WireEvent = { event_type: string, data: Record<string, unknown>, page_view_span_id?: string };
  type WirePayload = { events?: WireEvent[], spans?: WireSpan[] };

  function allSpans(sentBodies: string[]): WireSpan[] {
    return sentBodies.flatMap((body) => (JSON.parse(body) as WirePayload).spans ?? []);
  }

  function allEvents(sentBodies: string[]): WireEvent[] {
    return sentBodies.flatMap((body) => (JSON.parse(body) as WirePayload).events ?? []);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a $page-view span per navigation: the old one ends with scroll depth, the new one opens, events re-parent", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const firstSpanId = tracker.getCurrentPageViewSpanId();
      expect(firstSpanId).toBeTypeOf("string");

      window.history.pushState({}, "", "/second-page");
      const secondSpanId = tracker.getCurrentPageViewSpanId();
      expect(secondSpanId).toBeTypeOf("string");
      expect(secondSpanId).not.toBe(firstSpanId);

      tracker.trackCustomEvent("on_second_page").catch(() => {});
      await advancePastFlush();

      const pageViewSpans = allSpans(sentBodies).filter((span) => span.span_type === "$page-view");
      expect(pageViewSpans.map((span) => span.span_id)).toEqual([firstSpanId, secondSpanId]);

      const [first, second] = pageViewSpans;
      // The first page's interval closed at navigation and absorbed the final
      // scroll depth into the same row.
      expect(first.ended_at_ms).toBeTypeOf("number");
      expect(first.data.entry_type).toBe("initial");
      expect(first.data.scroll_depth_px).toBeTypeOf("number");
      expect(first.data.scroll_depth_ratio).toBeTypeOf("number");
      // A $page-view span never parents under another page.
      expect(first.page_view_span_id).toBeUndefined();
      // The second page's interval is still open.
      expect(second.ended_at_ms).toBeNull();
      expect(second.data.entry_type).toBe("push");

      // Custom events carry the page ancestry of the page they happened on.
      // Page views themselves are span-only (no companion $page-view event).
      const events = allEvents(sentBodies);
      expect(events.filter((event) => event.event_type === "$page-view")).toHaveLength(0);
      expect(events.find((event) => event.event_type === "on_second_page")?.page_view_span_id).toBe(secondSpanId);
    } finally {
      tracker.stop();
    }
  });

  it("marks the click completing a rapid same-spot burst as rage (earlier clicks stay unmarked)", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"buy\">Buy</button>";
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      for (let i = 0; i < 3; i++) {
        document.querySelector("#buy")?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 60 }));
      }
      await advancePastFlush();

      const clicks = allEvents(sentBodies).filter((event) => event.event_type === "$click");
      expect(clicks.map((click) => click.data.rage)).toEqual([undefined, undefined, 1]);
      clicks.forEach((click) => expect(click.page_view_span_id).toBeTypeOf("string"));
    } finally {
      tracker.stop();
    }
  });

  it("does not carry a rage-click burst across an SPA page view", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button id=\"buy\">Buy</button>";
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      for (let i = 0; i < 2; i++) {
        document.querySelector("#buy")?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 60 }));
      }
      window.history.pushState({}, "", "/after-navigation");
      document.querySelector("#buy")?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 60 }));
      await advancePastFlush();

      const clicks = allEvents(sentBodies).filter((event) => event.event_type === "$click");
      expect(clicks.map((click) => click.data.rage)).toEqual([undefined, undefined, undefined]);
    } finally {
      tracker.stop();
    }
  });

  it("flags outbound links and file-extension downloads on $click", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <a id="ext" href="https://other.example/whitepaper.pdf">Whitepaper</a>
      <a id="int" href="/pricing">Pricing</a>
    `;
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      document.querySelector("#ext")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector("#int")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await advancePastFlush();

      const clicks = allEvents(sentBodies).filter((event) => event.event_type === "$click");
      const ext = clicks.find((click) => click.data.href === "https://other.example/whitepaper.pdf");
      const int = clicks.find((click) => click.data.href === "/pricing");
      expect(ext?.data.outbound).toBe(1);
      expect(ext?.data.download).toBe(1);
      expect(int?.data.outbound).toBeUndefined();
      expect(int?.data.download).toBeUndefined();
    } finally {
      tracker.stop();
    }
  });

  it("captures $form-submit with field NAMES only — never values", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form id="quiz" name="quiz-form" action="/submit?token=secret" method="post">
        <input name="student_name" value="Ada Lovelace" />
        <input name="answer" value="42" />
        <input value="unnamed is skipped" />
        <button type="submit">Submit</button>
      </form>
    `;
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      document.querySelector("#quiz")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await advancePastFlush();

      const submit = allEvents(sentBodies).find((event) => event.event_type === "$form-submit");
      expect(submit).toBeDefined();
      expect(submit!.data.field_names).toEqual(["student_name", "answer"]);
      expect(submit!.data.form_id).toBe("quiz");
      expect(submit!.data.form_name).toBe("quiz-form");
      // The action's query string (which can carry user-derived values) is
      // stripped; only the path survives.
      expect(submit!.data.action_path).toBe("/submit");
      expect(JSON.stringify(submit!.data)).not.toContain("Ada Lovelace");
      expect(JSON.stringify(submit!.data)).not.toContain("secret");
    } finally {
      tracker.stop();
    }
  });

  it("drops an oversized autocapture item without poisoning the shared batch", async () => {
    vi.useFakeTimers();
    const fieldName = `field-${"x".repeat(65_000)}`;
    document.body.innerHTML = `<form id="oversized"><input name="${fieldName}" /></form>`;
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      tracker.start();
      document.querySelector("#oversized")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      tracker.trackCustomEvent("still_valid").catch(() => {});
      await advancePastFlush();

      const events = allEvents(sentBodies);
      expect(events.some((event) => event.event_type === "$form-submit")).toBe(false);
      expect(events.some((event) => event.event_type === "still_valid")).toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("dropping $form-submit"));
    } finally {
      tracker.stop();
      warning.mockRestore();
    }
  });

  it("captures $window-resize after the trailing debounce settles", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      // Continuous resize stream — only the settled size should land.
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
      await vi.advanceTimersByTimeAsync(499);
      expect(allEvents(sentBodies).some((event) => event.event_type === "$window-resize")).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await advancePastFlush();
      const resize = allEvents(sentBodies).find((event) => event.event_type === "$window-resize");
      expect(resize).toBeDefined();
      expect(resize!.data.viewport_width).toBe(window.innerWidth);
      expect(resize!.data.viewport_height).toBe(window.innerHeight);
    } finally {
      tracker.stop();
    }
  });

  it("tracks offline periods as $offline spans (open on offline, closed on online)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      window.dispatchEvent(new Event("offline"));
      await advancePastFlush();
      const openRows = allSpans(sentBodies).filter((span) => span.span_type === "$offline");
      expect(openRows).toHaveLength(1);
      expect(openRows[0].ended_at_ms).toBeNull();
      expect(openRows[0].page_view_span_id).toBe(tracker.getCurrentPageViewSpanId());

      window.dispatchEvent(new Event("online"));
      await advancePastFlush();
      const finalRows = allSpans(sentBodies).filter((span) => span.span_type === "$offline");
      expect(finalRows[finalRows.length - 1].ended_at_ms).toBeTypeOf("number");
    } finally {
      tracker.stop();
    }
  });

  it("restarts the $page-view span on sign-out rotation without a synthetic $page-view event", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const beforeRotation = tracker.getCurrentPageViewSpanId();
      await advancePastFlush();

      tracker.clearBuffer();
      tracker.setSessionReplaySegmentId("22222222-2222-4222-8222-222222222222");
      const afterRotation = tracker.getCurrentPageViewSpanId();
      expect(afterRotation).toBeTypeOf("string");
      expect(afterRotation).not.toBe(beforeRotation);

      await advancePastFlush();
      const rotationSpan = allSpans(sentBodies).find((span) => span.span_id === afterRotation);
      expect(rotationSpan?.span_type).toBe("$page-view");
      expect(rotationSpan?.data.entry_type).toBe("rotation");
      // Page views are span-only — neither the initial capture nor rotation
      // emits a companion $page-view event.
      expect(allEvents(sentBodies).filter((event) => event.event_type === "$page-view")).toHaveLength(0);
      // The pre-rotation span handle was inert-ified: no post-rotation re-write
      // of the old span id ships under the new identity.
      const oldSpanRows = allSpans(sentBodies).filter((span) => span.span_id === beforeRotation);
      for (const row of oldSpanRows) {
        expect(row.ended_at_ms).toBeNull();
      }
    } finally {
      tracker.stop();
    }
  });

  it("does not create product spans on identity rotation when Analytics is disabled", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, { productAnalyticsEnabled: false });
    try {
      tracker.start();
      expect(tracker.getCurrentPageViewSpanId()).toBeNull();
      tracker.setSessionReplaySegmentId("22222222-2222-4222-8222-222222222222");
      expect(tracker.getCurrentPageViewSpanId()).toBeNull();

      const logPromise = tracker.trackLogEvent({ message: "still observable", level: "info" });
      await advancePastFlush();
      await logPromise;
      expect(allEvents(sentBodies).map((event) => event.event_type)).toEqual(["$log"]);
      expect(allSpans(sentBodies)).toHaveLength(0);
    } finally {
      tracker.stop();
    }
  });
});

describe("EventTracker integrity signals (opt-in)", () => {
  function makeTracker(sentBodies: string[], integritySignals: boolean) {
    return new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      integritySignals,
    });
  }

  function setVisibilityState(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    // Restore jsdom's own visibilityState so later tests see "visible".
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    vi.useRealTimers();
  });

  function awayRows(sentBodies: string[]) {
    return sentBodies
      .flatMap((body) => (JSON.parse(body) as { spans?: { span_id: string, span_type: string, ended_at_ms: number | null, page_view_span_id?: string, data: Record<string, unknown> }[] }).spans ?? [])
      .filter((span) => span.span_type === "$away");
  }

  it("stays silent without the opt-in: no $away spans, no clipboard events", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, false);
    try {
      tracker.start();
      setVisibilityState("hidden");
      setVisibilityState("visible");
      document.dispatchEvent(new Event("copy", { bubbles: true }));
      await advancePastFlush();

      const payloads = sentBodies.map((body) => JSON.parse(body) as { events?: { event_type: string }[], spans?: { span_type: string }[] });
      expect(payloads.flatMap((payload) => payload.spans ?? []).some((span) => span.span_type === "$away")).toBe(false);
      expect(payloads.flatMap((payload) => payload.events ?? []).some((event) => event.event_type === "$copy")).toBe(false);
    } finally {
      tracker.stop();
    }
  });

  it("opens an $away span on hidden and closes it on visible (tab-out interval)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      setVisibilityState("hidden");
      // The keepalive flush triggered by going hidden already carries the OPEN
      // $away row — crucial because a hidden tab may never come back.
      await vi.advanceTimersByTimeAsync(0);
      const openRows = awayRows(sentBodies);
      expect(openRows).toHaveLength(1);
      expect(openRows[0].ended_at_ms).toBeNull();
      expect(openRows[0].data.reasons).toEqual(["tab-hidden"]);
      expect(openRows[0].page_view_span_id).toBe(tracker.getCurrentPageViewSpanId());

      await vi.advanceTimersByTimeAsync(5_000);
      setVisibilityState("visible");
      await advancePastFlush();
      const rows = awayRows(sentBodies);
      expect(rows[rows.length - 1].ended_at_ms).toBeTypeOf("number");
    } finally {
      tracker.stop();
    }
  });

  it("records window blur as an $away span and $context-menu / $print / $fullscreen-exit as events", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<div id=\"content\">text</div>";
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.querySelector("#content")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 6 }));
      window.dispatchEvent(new Event("beforeprint"));
      await advancePastFlush();

      const blurRows = awayRows(sentBodies);
      expect(blurRows.length).toBeGreaterThan(0);
      expect(blurRows[blurRows.length - 1].data.reasons).toEqual(["window-blur"]);
      expect(blurRows[blurRows.length - 1].ended_at_ms).toBeTypeOf("number");

      const events = sentBodies.flatMap((body) => (JSON.parse(body) as { events?: { event_type: string, data: Record<string, unknown> }[] }).events ?? []);
      const contextMenu = events.find((event) => event.event_type === "$context-menu");
      expect(contextMenu?.data.tag_name).toBe("div");
      expect(events.some((event) => event.event_type === "$print")).toBe(true);
    } finally {
      tracker.stop();
    }
  });

  it("merges a tab switch (blur + hidden) into ONE $away span whose reasons record both sensors", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      // A real tab switch fires blur first, then visibilitychange(hidden).
      window.dispatchEvent(new Event("blur"));
      setVisibilityState("hidden");
      await vi.advanceTimersByTimeAsync(5_000);
      // Return: visible + focus. Only then does the interval close.
      setVisibilityState("visible");
      window.dispatchEvent(new Event("focus"));
      await advancePastFlush();

      const rows = awayRows(sentBodies);
      const ids = new Set(rows.map((row) => row.span_id));
      expect(ids.size).toBe(1);
      const last = rows[rows.length - 1];
      expect(last.data.reasons).toEqual(["window-blur", "tab-hidden"]);
      expect(last.ended_at_ms).toBeTypeOf("number");
    } finally {
      tracker.stop();
    }
  });

  it("keeps the $away span open while any sensor still holds (focus back to a hidden tab)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      window.dispatchEvent(new Event("blur"));
      setVisibilityState("hidden");
      // Focus returns but the tab is still hidden — still away.
      window.dispatchEvent(new Event("focus"));
      await advancePastFlush();
      const openRows = awayRows(sentBodies);
      expect(openRows[openRows.length - 1].ended_at_ms).toBeNull();

      setVisibilityState("visible");
      await advancePastFlush();
      const rows = awayRows(sentBodies);
      expect(rows[rows.length - 1].ended_at_ms).toBeTypeOf("number");
      // reasons record what fired during the interval, not the final state.
      expect(rows[rows.length - 1].data.reasons).toEqual(["window-blur", "tab-hidden"]);
    } finally {
      tracker.stop();
    }
  });

  it("ends open away and offline intervals before the pagehide keepalive flush", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);

      const spans = sentBodies.flatMap((body) => (JSON.parse(body) as { spans?: { span_type: string, ended_at_ms: number | null }[] }).spans ?? []);
      for (const spanType of ["$away", "$offline"]) {
        const rows = spans.filter((span) => span.span_type === spanType);
        expect(rows[rows.length - 1]?.ended_at_ms).toBeTypeOf("number");
      }
    } finally {
      tracker.stop();
    }
  });

  it("restarts still-active away and offline intervals after a bfcache restore", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    setVisibilityState("hidden");
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    try {
      tracker.start();
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);

      const pageShow = new Event("pageshow");
      Object.defineProperty(pageShow, "persisted", { value: true });
      window.dispatchEvent(pageShow);
      await advancePastFlush();

      const spans = sentBodies.flatMap((body) => (JSON.parse(body) as { spans?: { span_id: string, span_type: string, ended_at_ms: number | null, page_view_span_id?: string }[] }).spans ?? []);
      for (const spanType of ["$away", "$offline"]) {
        const rows = spans.filter((span) => span.span_type === spanType);
        expect(new Set(rows.map((row) => row.span_id)).size).toBe(2);
        expect(rows[rows.length - 1]).toMatchObject({
          ended_at_ms: null,
          page_view_span_id: expect.any(String),
        });
        expect(rows[rows.length - 1]?.page_view_span_id).not.toBe(rows[0]?.page_view_span_id);
      }
    } finally {
      tracker.stop();
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    }
  });

  it("classifies paste origin without ever capturing clipboard content", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<textarea id=\"essay\"></textarea>";
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, true);
    const getSelectionSpy = vi.spyOn(document, "getSelection").mockReturnValue({ toString: () => "the answer is 42" } as Selection);
    try {
      tracker.start();
      // Copy on this page (selection mocked — jsdom has no real selections).
      document.dispatchEvent(new Event("copy", { bubbles: true }));

      const makePaste = (text: string) => {
        const event = new Event("paste", { bubbles: true });
        // jsdom cannot construct ClipboardEvent with clipboardData; the handler
        // only calls clipboardData.getData, so a minimal stand-in suffices.
        Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
        return event;
      };
      document.querySelector("#essay")?.dispatchEvent(makePaste("the answer is 42"));
      document.querySelector("#essay")?.dispatchEvent(makePaste("copied from ChatGPT"));
      await advancePastFlush();

      const events = sentBodies.flatMap((body) => (JSON.parse(body) as { events?: { event_type: string, data: Record<string, unknown> }[] }).events ?? []);
      const copy = events.find((event) => event.event_type === "$copy");
      expect(copy?.data.selection_length).toBe("the answer is 42".length);

      const pastes = events.filter((event) => event.event_type === "$paste");
      expect(pastes.map((paste) => paste.data.same_page_origin)).toEqual([1, 0]);
      expect(pastes.map((paste) => paste.data.length)).toEqual(["the answer is 42".length, "copied from ChatGPT".length]);
      // The content itself never rides the wire.
      for (const body of sentBodies) {
        expect(body).not.toContain("the answer is 42");
        expect(body).not.toContain("copied from ChatGPT");
      }
    } finally {
      tracker.stop();
      getSelectionSpy.mockRestore();
    }
  });
});

describe("EventTracker $http-client spans", () => {
  function makeTracker(sentBodies: string[], extraDeps?: Partial<import("./event-tracker").EventTrackerDeps>) {
    return new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      ...extraDeps,
    });
  }

  type WireSpan = {
    trace_id: string,
    span_id: string,
    span_type: string,
    ended_at_ms: number | null,
    parent_span_id: string | null,
    data: Record<string, unknown>,
    page_view_span_id?: string,
  };

  function allSpans(sentBodies: string[]): WireSpan[] {
    return sentBodies.flatMap((body) => (JSON.parse(body) as { spans?: WireSpan[] }).spans ?? []);
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records a $http-client span with sanitized url, page correlation, and outcome data", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const pageViewSpanId = tracker.getCurrentPageViewSpanId();
      const handle = tracker.beginHttpRequestSpan({ url: "https://api.example.com/v1/orders?token=secret", method: "POST", transport: "fetch" });
      expect(handle).not.toBeNull();
      expect(handle?.propagate).toBe(true);
      handle?.end({ status: 502, errored: false, aborted: false, propagated: true });
      await advancePastFlush();

      const spans = allSpans(sentBodies).filter((span) => span.span_type === "$http-client");
      expect(spans).toHaveLength(1);
      // The page view is BOTH: correlation (the column) and — with no nearer
      // ambient span — the parent, so the request and the backend work it
      // triggers land in the trace of the page that made it.
      expect(spans[0].page_view_span_id).toBe(pageViewSpanId);
      expect(spans[0].parent_span_id).toBe(pageViewSpanId);
      expect(spans[0].ended_at_ms).toBeTypeOf("number");
      expect(handle?.spanContext).toEqual({ traceId: spans[0].trace_id, spanId: spans[0].span_id });
      expect(spans[0].data).toMatchObject({
        method: "POST",
        // Query strings are stripped at capture (they routinely carry tokens).
        url: "https://api.example.com/v1/orders",
        transport: "fetch",
        status: 502,
        propagated: 1,
      });
    } finally {
      tracker.stop();
    }
  });

  it("parents under the nearest ambient custom span (fetch inside withSpan nests under it)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies);
    try {
      tracker.start();
      const parent = tracker.startSpan("checkout");
      tracker.setGlobalSpan(parent);
      const handle = tracker.beginHttpRequestSpan({ url: "https://api.example.com/pay", method: "POST", transport: "fetch" });
      handle?.end({ status: 200, errored: false, aborted: false });
      await advancePastFlush();

      const httpSpans = allSpans(sentBodies).filter((span) => span.span_type === "$http-client");
      expect(httpSpans[0].parent_span_id).toBe(parent.spanId);
      expect(httpSpans[0].trace_id).toBe(parent.traceId);
    } finally {
      tracker.stop();
    }
  });

  it("MANDATORY: a batch flush through the instrumented fetch must not create a span (recursion guard)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const API_ORIGIN = "https://api.example.test";
    // Underlying transport stub; the propagation wrapper installs on top of it.
    const underlyingFetch = ((..._args: unknown[]) => Promise.resolve(new Response())) as typeof fetch;
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = underlyingFetch;
    const tracker = makeTracker(sentBodies, {
      sendBatch: async (body) => {
        sentBodies.push(body);
        // The real SDK transport goes through the (wrapped) global fetch.
        const response = await globalThis.fetch(`${API_ORIGIN}/api/v1/analytics/events/batch`, { method: "POST", body });
        return Result.ok(response);
      },
      shouldIgnoreFetchUrl: (url) => url.startsWith(`${API_ORIGIN}/`),
    });
    const uninstall = installFetchSpanPropagation({
      getContext: () => null,
      getSelfOrigin: () => API_ORIGIN,
      getAllowedOrigins: () => [],
      beginRequestSpan: (info) => tracker.beginHttpRequestSpan(info),
    });
    try {
      tracker.start();
      // One real (non-SDK) request so there is at least something to flush and
      // a control proving the factory works at all.
      const handle = tracker.beginHttpRequestSpan({ url: "https://api.example.com/data", method: "GET", transport: "fetch" });
      handle?.end({ status: 200, errored: false, aborted: false });
      await advancePastFlush();
      // The flush itself went through the wrapped fetch; give any (wrongly)
      // created span a chance to be flushed too.
      await advancePastFlush();
      await advancePastFlush();

      const httpSpans = allSpans(sentBodies).filter((span) => span.span_type === "$http-client");
      expect(httpSpans).toHaveLength(1);
      expect(httpSpans[0].data.url).toBe("https://api.example.com/data");
    } finally {
      tracker.stop();
      uninstall?.();
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("caps $http-client spans per page view (warns once) and resets on navigation", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentBodies: string[] = [];
    // errors-only keeps the cap logic reachable without buffering 500 rows.
    const tracker = makeTracker(sentBodies, {
      networkCapture: {
        enabled: true, capture: "errors-only", sampleRate: 1, allowOrigins: null, denyOrigins: null, ignoreUrls: [],
      },
    });
    try {
      tracker.start();
      for (let i = 0; i < HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP; i += 1) {
        // End immediately (dropped: fast success in errors-only) so the live
        // registries don't interfere with the count — the budget counts
        // OPENED requests, kept or not.
        tracker.beginHttpRequestSpan({ url: "https://x.example/a", method: "GET", transport: "fetch" })
          ?.end({ status: 200, errored: false, aborted: false });
      }
      expect(tracker.beginHttpRequestSpan({ url: "https://x.example/a", method: "GET", transport: "fetch" })).toBeNull();
      expect(warnSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("$http-client")).length).toBe(1);
      // Navigation resets the budget.
      window.history.pushState({}, "", "/next-page");
      expect(tracker.beginHttpRequestSpan({ url: "https://x.example/a", method: "GET", transport: "fetch" })).not.toBeNull();
    } finally {
      tracker.stop();
      warnSpy.mockRestore();
    }
  });

  it("returns null for ignored, filtered, and disabled capture", () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = makeTracker(sentBodies, {
      shouldIgnoreFetchUrl: (url) => url.includes("ignored.example"),
      networkCapture: {
        enabled: true, capture: "all", sampleRate: 1, allowOrigins: null, denyOrigins: ["https://denied.example"], ignoreUrls: ["/skip-me"],
      },
    });
    try {
      tracker.start();
      expect(tracker.beginHttpRequestSpan({ url: "https://ignored.example/a", method: "GET", transport: "fetch" })).toBeNull();
      expect(tracker.beginHttpRequestSpan({ url: "https://denied.example/a", method: "GET", transport: "fetch" })).toBeNull();
      expect(tracker.beginHttpRequestSpan({ url: "https://x.example/skip-me", method: "GET", transport: "fetch" })).toBeNull();
      expect(tracker.beginHttpRequestSpan({ url: "wss://x.example/socket", method: "GET", transport: "fetch" })).toBeNull();
      expect(tracker.beginHttpRequestSpan({ url: "https://x.example/kept", method: "GET", transport: "fetch" })).not.toBeNull();
    } finally {
      tracker.stop();
    }
  });
});

describe("EventTracker per-navigation web vitals", () => {
  // Mirrors the mock in web-vitals.test.ts: one instance per observed type,
  // entries injected by the test.
  class MockPerformanceObserver {
    static supportedEntryTypes = ["navigation", "paint", "largest-contentful-paint", "layout-shift", "event", "first-input"];
    static instances: MockPerformanceObserver[] = [];

    observedType: string | null = null;
    disconnected = false;

    constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {
      MockPerformanceObserver.instances.push(this);
    }

    observe(options: { type: string }) {
      this.observedType = options.type;
    }

    disconnect() {
      this.disconnected = true;
    }

    emit(entries: unknown[]) {
      this.callback({ getEntries: () => entries });
    }

    static byType(type: string): MockPerformanceObserver[] {
      return MockPerformanceObserver.instances.filter((candidate) => candidate.observedType === type);
    }
  }

  afterEach(() => {
    MockPerformanceObserver.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("attaches a fresh collector per $page-view: full metrics initially, soft-nav CLS/INP after SPA navigations", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      resource: TEST_RESOURCE,
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });
    try {
      tracker.start();
      const firstSpanId = tracker.getCurrentPageViewSpanId();
      // Initial mode installs the load-metric observers.
      expect(MockPerformanceObserver.byType("navigation")).toHaveLength(1);
      MockPerformanceObserver.byType("paint")[0].emit([{ name: "first-contentful-paint", startTime: 100 }]);

      window.history.pushState({}, "", "/second");
      const secondSpanId = tracker.getCurrentPageViewSpanId();
      // The initial collector was disconnected with its span; a soft-nav
      // collector attached for the new span WITHOUT load-metric observers.
      expect(MockPerformanceObserver.byType("navigation")).toHaveLength(1);
      expect(MockPerformanceObserver.byType("layout-shift")).toHaveLength(2);
      const initialObservers = MockPerformanceObserver.instances.filter((observer) => observer.observedType === "paint");
      expect(initialObservers.every((observer) => observer.disconnected)).toBe(true);

      // A layout shift after the navigation lands on the NEW span, soft_nav-flagged.
      const softNavLayoutShift = MockPerformanceObserver.byType("layout-shift")[1];
      softNavLayoutShift.emit([{ startTime: performance.now() + 1, value: 0.25, hadRecentInput: false }]);

      window.history.pushState({}, "", "/third");
      await advancePastFlush();

      const spans = sentBodies
        .flatMap((body) => (JSON.parse(body) as { spans?: { span_id: string, span_type: string, data: Record<string, unknown> }[] }).spans ?? [])
        .filter((span) => span.span_type === "$page-view");
      const first = spans.find((span) => span.span_id === firstSpanId);
      const second = spans.find((span) => span.span_id === secondSpanId);
      expect((first?.data.web_vitals as Record<string, unknown>).fcp_ms).toBe(100);
      expect((first?.data.web_vitals as Record<string, unknown>).soft_nav).toBeUndefined();
      expect(second?.data.web_vitals).toMatchObject({ soft_nav: 1, cls: 0.25 });
      expect((second?.data.web_vitals as Record<string, unknown>).fcp_ms).toBeUndefined();
    } finally {
      tracker.stop();
    }
  });
});
