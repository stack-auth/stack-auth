// @vitest-environment jsdom

import { propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventTracker, type EventTrackerDeps } from "./event-tracker";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SEGMENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ROOT = {
  traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  spanId: "bbbbbbbbbbbbbbbb",
  traceState: "vendor=value",
};

const loggerProviders: LoggerProvider[] = [];
const tracerProviders: BasicTracerProvider[] = [];

function installOtel(): {
  logsExporter: InMemoryLogRecordExporter,
  spansExporter: InMemorySpanExporter,
  loggerProvider: LoggerProvider,
} {
  const logsExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logsExporter })],
  });
  loggerProviders.push(loggerProvider);
  logs.setGlobalLoggerProvider(loggerProvider);

  const spansExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spansExporter)],
  });
  tracerProviders.push(tracerProvider);
  if (!trace.setGlobalTracerProvider(tracerProvider)) throw new Error("Could not install test TracerProvider");
  return { logsExporter, spansExporter, loggerProvider };
}

function makeTracker(overrides?: Partial<EventTrackerDeps>): EventTracker {
  return new EventTracker({
    projectId: PROJECT_ID,
    resource: { service: { name: "browser-test" } },
    clientVersion: "test-version",
    sessionReplaySegmentId: SEGMENT_ID,
    sessionRootContext: SESSION_ROOT,
    productAnalyticsEnabled: true,
    ...overrides,
  });
}

afterEach(async () => {
  vi.useRealTimers();
  document.body.replaceChildren();
  Reflect.set(globalThis, "hexclaveCapturedErrors", []);
  trace.disable();
  logs.disable();
  await Promise.all(loggerProviders.splice(0).map(async (provider) => await provider.shutdown()));
  await Promise.all(tracerProviders.splice(0).map(async (provider) => await provider.shutdown()));
  vi.restoreAllMocks();
});

describe("EventTracker OTel autocapture", () => {
  it("does not re-report a failed background OTLP flush as an application error", async () => {
    vi.useFakeTimers();
    const forceFlushOtel = vi.fn(async () => {
      throw new Error("OTLP endpoint unavailable");
    });
    const tracker = makeTracker({ forceFlushOtel });
    document.body.innerHTML = "<button id=checkout>Checkout</button>";
    tracker.start();
    document.querySelector("#checkout")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    Reflect.set(globalThis, "hexclaveCapturedErrors", []);

    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(forceFlushOtel).toHaveBeenCalledOnce();
    expect(Reflect.get(globalThis, "hexclaveCapturedErrors")).toEqual([]);
    tracker.stop();
  });

  it("emits explicit product events as named LogRecords, never a legacy batch", async () => {
    const otel = installOtel();
    const forceFlush = vi.fn(async () => await otel.loggerProvider.forceFlush());
    const tracker = makeTracker({ forceFlushOtel: forceFlush });

    await tracker.trackCustomEvent("checkout_completed", { amount: 42 }, { parent: SESSION_ROOT });

    expect(forceFlush).toHaveBeenCalledOnce();
    expect(otel.logsExporter.getFinishedLogRecords()).toMatchObject([{
      eventName: "checkout_completed",
      spanContext: { traceId: SESSION_ROOT.traceId, spanId: SESSION_ROOT.spanId },
      attributes: {
        "hexclave.signal.type": "event",
        "hexclave.session_replay.segment.id": SEGMENT_ID,
        "hexclave.data": { amount: 42 },
      },
    }]);
  });

  it("rejects invalid public event names and cyclic structured data before OTel", async () => {
    const otel = installOtel();
    const tracker = makeTracker();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(tracker.trackCustomEvent("$reserved")).rejects.toThrow();
    await expect(tracker.trackCustomEvent("valid", cyclic)).rejects.toThrow();
    expect(otel.logsExporter.getFinishedLogRecords()).toHaveLength(0);
  });

  it("records page views as OTel spans and clicks as child-correlated LogRecords", async () => {
    const otel = installOtel();
    const tracker = makeTracker({ forceFlushOtel: async () => await otel.loggerProvider.forceFlush() });
    document.body.innerHTML = "<button id=checkout>Checkout</button>";
    tracker.start();
    const pageViewSpanId = tracker.getCurrentPageViewSpanId();
    if (pageViewSpanId === null) throw new Error("Expected startup to create a page-view span");

    document.querySelector("#checkout")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: 20,
      clientY: 30,
    }));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await tracker.flush();

    const click = otel.logsExporter.getFinishedLogRecords().find((record) => record.eventName === "$click");
    if (click === undefined) throw new Error("Expected a click LogRecord");
    expect(click.spanContext).toMatchObject({ traceId: SESSION_ROOT.traceId, spanId: pageViewSpanId });
    expect(click.attributes).toMatchObject({
      "hexclave.signal.type": "event",
      "hexclave.session_replay.segment.id": SEGMENT_ID,
      "hexclave.page_view.span_id": pageViewSpanId,
    });
    expect(click.attributes["hexclave.data"]).toMatchObject({ tag_name: "button", text: "Checkout" });

    const pageView = otel.spansExporter.getFinishedSpans().find((span) => span.name === "$page-view");
    if (pageView === undefined) throw new Error("Expected a page-view span");
    expect(pageView.spanContext()).toMatchObject({ traceId: SESSION_ROOT.traceId, spanId: pageViewSpanId });
    expect(pageView.parentSpanContext).toMatchObject({ spanId: SESSION_ROOT.spanId });
    tracker.stop();
  });

  it("exposes the current page view as the ambient OTel context with correlation baggage", () => {
    installOtel();
    const tracker = makeTracker();
    // Before the first page view the SESSION ROOT anchors the ambient, so
    // bootstrap requests join the session trace instead of rooting their own.
    const preStart = tracker.getAmbientOtelContext();
    if (preStart === null) throw new Error("Expected a session-root ambient before the first page view");
    expect(trace.getSpanContext(preStart)).toMatchObject({ traceId: SESSION_ROOT.traceId, spanId: SESSION_ROOT.spanId });
    expect(propagation.getBaggage(preStart)?.getEntry("hexclave.page_view.span_id")).toBeUndefined();
    // Without a session root there is nothing safe to anchor on.
    expect(makeTracker({ sessionRootContext: undefined }).getAmbientOtelContext()).toBeNull();

    tracker.start();
    const pageViewSpanId = tracker.getCurrentPageViewSpanId();
    if (pageViewSpanId === null) throw new Error("Expected startup to create a page-view span");
    const ambient = tracker.getAmbientOtelContext();
    if (ambient === null) throw new Error("Expected an ambient context once the page-view span exists");
    expect(trace.getSpanContext(ambient)).toMatchObject({ traceId: SESSION_ROOT.traceId, spanId: pageViewSpanId });
    const baggage = propagation.getBaggage(ambient);
    expect(baggage?.getEntry("hexclave.page_view.span_id")?.value).toBe(pageViewSpanId);
    expect(baggage?.getEntry("hexclave.session_replay.segment.id")?.value).toBe(SEGMENT_ID);
    // Stable identity while the page view is unchanged (it sits on the context
    // manager's hot path), rebuilt when navigation replaces the span.
    expect(tracker.getAmbientOtelContext()).toBe(ambient);

    window.history.pushState({}, "", "/next-page");
    const afterNavigation = tracker.getAmbientOtelContext();
    if (afterNavigation === null) throw new Error("Expected an ambient context after navigation");
    expect(trace.getSpanContext(afterNavigation)?.spanId).toBe(tracker.getCurrentPageViewSpanId());
    expect(trace.getSpanContext(afterNavigation)?.spanId).not.toBe(pageViewSpanId);

    // After teardown the page view has ended; new work must not stitch itself
    // into the ended session (see the sign-out window note on the method).
    tracker.stop();
    expect(tracker.getAmbientOtelContext()).toBeNull();
  });

  it("keeps a click local until dead-click classification has completed", async () => {
    vi.useFakeTimers();
    const otel = installOtel();
    const tracker = makeTracker({ forceFlushOtel: async () => await otel.loggerProvider.forceFlush() });
    document.body.innerHTML = "<button id=dead>Does nothing</button>";
    tracker.start();

    document.querySelector("#dead")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tracker.flush();
    expect(otel.logsExporter.getFinishedLogRecords().find((record) => record.eventName === "$click")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(3_000);
    await tracker.flush();
    const click = otel.logsExporter.getFinishedLogRecords().find((record) => record.eventName === "$click");
    if (click === undefined) throw new Error("Expected classified click");
    expect(click.attributes["hexclave.data"]).toMatchObject({ dead: 1 });
    tracker.stop();
  });

  it("drops locally staged autocapture when browser identity rotates", async () => {
    const otel = installOtel();
    const tracker = makeTracker({ forceFlushOtel: async () => await otel.loggerProvider.forceFlush() });
    document.body.innerHTML = "<button id=pending>Pending</button>";
    tracker.start();
    document.querySelector("#pending")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    tracker.clearBuffer();
    await tracker.flush();

    expect(otel.logsExporter.getFinishedLogRecords().find((record) => record.eventName === "$click")).toBeUndefined();
    tracker.stop();
  });

  it("does not install product autocapture when analytics is disabled", async () => {
    const otel = installOtel();
    const tracker = makeTracker({ productAnalyticsEnabled: false });
    document.body.innerHTML = "<button id=ignored>Ignored</button>";
    tracker.start();
    document.querySelector("#ignored")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await tracker.flush();

    expect(otel.logsExporter.getFinishedLogRecords()).toHaveLength(0);
    expect(otel.spansExporter.getFinishedSpans()).toHaveLength(0);
    tracker.stop();
  });

  it("records opted-in integrity events through the same LogRecord contract", async () => {
    const otel = installOtel();
    const tracker = makeTracker({
      integritySignals: true,
      forceFlushOtel: async () => await otel.loggerProvider.forceFlush(),
    });
    document.body.innerHTML = "<main id=target>Menu target</main>";
    tracker.start();
    document.querySelector("#target")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await tracker.flush();

    const event = otel.logsExporter.getFinishedLogRecords().find((record) => record.eventName === "$context-menu");
    expect(event?.attributes["hexclave.signal.type"]).toBe("event");
    tracker.stop();
  });
});
