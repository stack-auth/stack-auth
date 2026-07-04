// @vitest-environment jsdom

import { KnownErrors } from "@hexclave/shared/dist/known-errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventTracker, withSpanImpl } from "./event-tracker";

async function advancePastFlush() {
  await vi.advanceTimersByTimeAsync(10_000);
  await Promise.resolve();
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
  afterEach(() => {
    vi.useRealTimers();
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

      // Dead-click classification marks the buffered $click in place —
      // exactly one click event either way.
      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        [
          "$page-view",
          "$click",
        ]
      `);
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

      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        [
          "$page-view",
        ]
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

      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        [
          "$page-view",
        ]
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
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      window.history.pushState({}, "", "/projects/test-project");

      await advancePastFlush();

      expect(getSentEventTypes(sentBodies)).toMatchInlineSnapshot(`
        [
          "$page-view",
          "$page-view",
        ]
      `);
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

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { events: { event_type: string, data: Record<string, unknown>, parent_span_ids?: string[] }[] };
      expect(payload.events.map((event) => event.event_type)).toEqual(["$page-view", "checkout_completed"]);
      const custom = payload.events[1];
      expect(custom.data).toEqual({ cart_size: 3 });
      // No parents were given and no globals are set — the key is omitted
      // entirely (the server stamps system ancestry on every event anyway).
      expect(custom.parent_span_ids).toBeUndefined();
    } finally {
      tracker.stop();
    }
  });

  it("rejects (pre-caught, never throws) on invalid names, data, and parent ids", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tracker = new EventTracker({
      projectId: "internal",
      sendBatch: async () => Result.ok(new Response()),
    });

    try {
      tracker.start();
      // $-prefixed names are reserved for system telemetry.
      await expect(tracker.trackCustomEvent("$page-view")).rejects.toThrow(/reserved for system telemetry/);
      await expect(tracker.trackCustomEvent("1-starts-with-digit")).rejects.toThrow(/must start with a letter/);
      await expect(tracker.trackCustomEvent("x".repeat(65))).rejects.toThrow(/at most 64 characters/);
      await expect(tracker.trackCustomEvent("ok", [1, 2] as any)).rejects.toThrow(/plain JSON-serializable object/);
      await expect(tracker.trackCustomEvent("ok", { big: "x".repeat(17_000) })).rejects.toThrow(/at most 16000 bytes/);
      await expect(tracker.trackCustomEvent("ok", { big: "é".repeat(8_000) })).rejects.toThrow(/at most 16000 bytes/);
      await expect(tracker.trackCustomEvent("ok", {}, { parentIds: ["not-a-uuid"] })).rejects.toThrow(/parent ids must be span uuids/);
      // Ignoring the rejected promise entirely must not blow up the test run
      // (the internal catch keeps it from ever being an unhandled rejection).
      tracker.trackCustomEvent("$ignored").catch(() => {});
      expect(errorSpy).toHaveBeenCalled();

      // Invalid startSpan input yields an inert span rather than a throw.
      const inert = tracker.startSpan("$reserved");
      await expect(inert.end()).resolves.toBeUndefined();

      // Nothing invalid was buffered.
      await advancePastFlush();
    } finally {
      tracker.stop();
      errorSpy.mockRestore();
    }
  });

  it("writes a span open on start, dedupes in-batch re-writes to the latest row, and settles every promise", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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
      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_id: string, span_type: string, ended_at_ms: number | null, data: Record<string, unknown>, parent_span_ids: string[] }[] };
      expect(payload.spans).toHaveLength(1);
      const row = payload.spans![0];
      expect(row.span_id).toBe(span.spanId);
      expect(row.span_type).toBe("checkout-flow");
      expect(row.ended_at_ms).not.toBeNull();
      expect(row.data).toEqual({ cart_size: 3, coupon: "SAVE10" });
      expect(row.parent_span_ids).toEqual([]);
    } finally {
      tracker.stop();
    }
  });

  it("falls back to a finite timestamp when a span is ended with an invalid endedAtMs", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const span = tracker.startSpan("checkout-flow");
      const endPromise = span.end({ endedAtMs: Number.NaN });
      await advancePastFlush();
      await expect(endPromise).resolves.toBeUndefined();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { ended_at_ms: number | null }[] };
      expect(payload.spans).toHaveLength(1);
      expect(payload.spans![0].ended_at_ms).toBeTypeOf("number");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("endedAtMs must be a finite"));
    } finally {
      tracker.stop();
      errorSpy.mockRestore();
    }
  });

  it("re-writes a span across flushes with a strictly increasing version", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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

      const first = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { ended_at_ms: number | null, updated_at_ms: number }[] };
      const second = JSON.parse(sentBodies[1] ?? "{}") as { spans?: { ended_at_ms: number | null, updated_at_ms: number }[] };
      expect(first.spans![0].ended_at_ms).toBeNull();
      expect(second.spans![0].ended_at_ms).not.toBeNull();
      // The end row must always beat the open row in the ReplacingMergeTree,
      // even if the batches arrive out of order server-side.
      expect(second.spans![0].updated_at_ms).toBeGreaterThan(first.spans![0].updated_at_ms);
    } finally {
      tracker.stop();
    }
  });

  it("parents children and events under global spans and handle chains (span2.trackEvent inherits everything)", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      const checkout = tracker.startSpan("checkout-flow");
      tracker.setGlobalSpan(checkout);

      // Child created via the handle: chain = [checkout].
      const payment = checkout.startSpan("payment-step");
      // Event tracked via the child handle: parents = ambient (checkout) +
      // payment's chain (checkout, deduped) + payment itself.
      const eventPromise = payment.trackEvent("card_declined", { code: "51" });

      // A raw uuid parent contributes only itself, additively.
      const rawParent = "0f000000-0000-4000-8000-00000000cccc";
      tracker.trackCustomEvent("hint_shown", {}, { parentIds: [rawParent] }).catch(() => {});

      await advancePastFlush();
      await expect(eventPromise).resolves.toBeUndefined();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as {
        events: { event_type: string, parent_span_ids?: string[] }[],
        spans?: { span_id: string, parent_span_ids: string[] }[],
      };
      const paymentRow = payload.spans!.find((row) => row.span_id === payment.spanId);
      expect(paymentRow!.parent_span_ids).toEqual([checkout.spanId]);

      const declined = payload.events.find((event) => event.event_type === "card_declined");
      expect(declined!.parent_span_ids).toEqual([checkout.spanId, payment.spanId]);

      const hint = payload.events.find((event) => event.event_type === "hint_shown");
      expect(hint!.parent_span_ids).toEqual([checkout.spanId, rawParent]);

      // Ending a global span auto-unsets it: subsequent events have no parents.
      checkout.end().catch(() => {});
      tracker.trackCustomEvent("after_end").catch(() => {});
      await advancePastFlush();
      const second = JSON.parse(sentBodies[1] ?? "{}") as { events: { event_type: string, parent_span_ids?: string[] }[] };
      const after = second.events.find((event) => event.event_type === "after_end");
      expect(after!.parent_span_ids).toBeUndefined();
    } finally {
      tracker.stop();
    }
  });

  it("continues a span tree from a serialized SpanRef with full ancestry", async () => {
    vi.useFakeTimers();
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    try {
      tracker.start();
      // Simulates a span minted on another tier (e.g. the server) and passed
      // through JSON: the ref carries its own ancestor chain.
      const serverRef = {
        spanId: "0f000000-0000-4000-8000-00000000dddd",
        parentSpanIds: ["0f000000-0000-4000-8000-00000000eeee"],
      };
      const child = tracker.startSpan("client-continuation", { parentIds: [serverRef] });
      await advancePastFlush();

      const payload = JSON.parse(sentBodies[0] ?? "{}") as { spans?: { span_id: string, parent_span_ids: string[] }[] };
      expect(payload.spans![0].span_id).toBe(child.spanId);
      expect(payload.spans![0].parent_span_ids).toEqual([serverRef.parentSpanIds[0], serverRef.spanId]);
      expect(child.ref()).toEqual({ spanId: child.spanId, parentSpanIds: [serverRef.parentSpanIds[0], serverRef.spanId] });
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
        const payload = JSON.parse(body) as { events: { event_type: string }[], spans?: unknown[] };
        expect(payload.spans).toBeUndefined();
        expect(payload.events.every((event) => event.event_type === "$page-view")).toBe(true);
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
      expect(payload.spans).toHaveLength(1);
      expect(payload.spans![0].span_type).toBe("abandoned-flow");
      // No auto-end on unload: the span survives as an open interval by design.
      expect(payload.spans![0].ended_at_ms).toBeNull();
    } finally {
      tracker.stop();
    }
  });

  it("withSpan auto-ends the span and ambient-parents everything created inside", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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
      events: { event_type: string, parent_span_ids?: string[] }[],
      spans?: { span_id: string, span_type: string, ended_at_ms: number | null, parent_span_ids: string[] }[],
    };
    const outerRow = payload.spans!.find((row) => row.span_type === "outer-flow")!;
    expect(outerRow.ended_at_ms).not.toBeNull();   // auto-ended on settle
    expect(outerRow.parent_span_ids).toEqual([]);  // its own parents come from the ENCLOSING context
    const innerRow = payload.spans!.find((row) => row.span_id === innerSpanId)!;
    expect(innerRow.parent_span_ids).toEqual([outerRow.span_id]);
    const innerEvent = payload.events.find((event) => event.event_type === "inner_event")!;
    expect(innerEvent.parent_span_ids).toEqual([outerRow.span_id]);

    // The frame is gone after withSpan settles: no ambient parent here.
    tracker.trackCustomEvent("after_frame").catch(() => {});
    await tracker.flush();
    const second = JSON.parse(sentBodies[1] ?? "{}") as { events: { event_type: string, parent_span_ids?: string[] }[] };
    expect(second.events.find((event) => event.event_type === "after_frame")!.parent_span_ids).toBeUndefined();
  });

  it("withSpan records data.error, ends the span, and rethrows on failure", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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

  it("root drops all ambient parents and excludeParentIds filters the FINAL merged list", async () => {
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
      sendBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
    });

    await withSpanImpl(
      (type, options) => tracker.startSpan(type, options),
      "outer",
      async (outer) => {
        const detached = tracker.startSpan("detached", { root: true });
        expect(detached.ref().parentSpanIds).toEqual([]);

        const child = tracker.startSpan("child");   // chain: [outer]
        // Excluding outer removes it from the final list even though it
        // re-enters via child's frozen chain — deliberate final-list semantics:
        // this row is a child of `child` but NOT a descendant of `outer`.
        tracker.trackCustomEvent("evt", {}, { parentIds: [child], excludeParentIds: [outer] }).catch(() => {});
        child.end().catch(() => {});
        detached.end().catch(() => {});
      },
    );

    await tracker.flush();
    const payload = JSON.parse(sentBodies[0] ?? "{}") as {
      events: { event_type: string, parent_span_ids?: string[] }[],
      spans?: { span_id: string, span_type: string, parent_span_ids: string[] }[],
    };
    const outerRow = payload.spans!.find((row) => row.span_type === "outer")!;
    const childRow = payload.spans!.find((row) => row.span_type === "child")!;
    expect(payload.spans!.find((row) => row.span_type === "detached")!.parent_span_ids).toEqual([]);
    expect(childRow.parent_span_ids).toEqual([outerRow.span_id]);
    expect(payload.events.find((event) => event.event_type === "evt")!.parent_span_ids).toEqual([childRow.span_id]);
  });

  it("passes every batch-send promise to registerBackgroundTask (waitUntil hook)", async () => {
    const registered: Promise<unknown>[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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

  it("silently disables when client interface returns ANALYTICS_NOT_ENABLED as an error", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Click me</button>";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentBodies: string[] = [];
    const tracker = new EventTracker({
      projectId: "internal",
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
    } finally {
      tracker.stop();
      warnSpy.mockRestore();
    }
  });
});
