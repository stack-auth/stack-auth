// @vitest-environment jsdom

import { isW3cSpanId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { Result } from "@hexclave/shared/dist/utils/results";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackClientApp } from "../interfaces/client-app";
import { ClientAnalytics } from "./client-analytics";
import { shouldIgnoreTelemetryDeliveryUrl } from "./client-app-impl";
import { EventTracker } from "./event-tracker";
import { normalizeNetworkCaptureOptions } from "./network-capture";
import { SessionRecorder } from "./session-replay";
import type { SpanContext, SpanUpdateRow } from "./telemetry-core";

const TEST_TELEMETRY = { resource: { service: { name: "test-client" } } } as const;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser analytics startup", () => {
  function stubSessionRootContext(app: StackClientApp<boolean, string>) {
    const analytics = Reflect.get(app, "_clientAnalytics");
    const deps = Reflect.get(analytics, "_deps");
    vi.spyOn(deps, "getSessionRootContext").mockResolvedValue({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });
  }

  it("gates Analytics and Observability independently while retaining one facade", async () => {
    const analyticsDisabled = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      analytics: { enabled: false },
      observability: { enabled: true },
      telemetry: TEST_TELEMETRY,
    });
    const sharedFacade = Reflect.get(analyticsDisabled, "_clientAnalytics");
    expect(sharedFacade).toBeInstanceOf(ClientAnalytics);
    expect(Reflect.get(sharedFacade, "_deps")).toMatchObject({ productAnalyticsEnabled: false });
    await expect(analyticsDisabled.trackEvent("product-event")).rejects.toThrow("telemetry is unavailable");

    const observabilityDisabled = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000002",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      analytics: { enabled: true, replays: { enabled: false } },
      observability: { enabled: false },
      telemetry: TEST_TELEMETRY,
    });
    const observabilityFacade = Reflect.get(observabilityDisabled, "_clientAnalytics");
    const startSpan = vi.spyOn(observabilityFacade, "startSpan");
    observabilityDisabled.startSpan("db.query");
    expect(startSpan).not.toHaveBeenCalled();
  });

  it("lazily starts replay and event capture for an SSR app with tokenStore null", async () => {
    const replayStart = vi.spyOn(SessionRecorder.prototype, "start").mockImplementation(() => {});
    const eventStart = vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      telemetry: TEST_TELEMETRY,
    });

    // The analytics runtime is lazy-loaded: the facade exists synchronously,
    // but the tracker/recorder modules (and their start()) only run once the
    // deferred import completes.
    const analytics = Reflect.get(app, "_clientAnalytics");
    expect(analytics).toBeInstanceOf(ClientAnalytics);
    expect(eventStart).not.toHaveBeenCalled();
    // This unit exercises lazy runtime startup, not anonymous-session signup.
    // Production resolves this context from the authenticated refresh token.
    stubSessionRootContext(app);

    await (analytics as ClientAnalytics).loadNow();

    expect(replayStart).toHaveBeenCalledOnce();
    expect(eventStart).toHaveBeenCalledOnce();
  });

  it("starts click and page-view capture while session trace identity is still resolving", async () => {
    const sentBodies: string[] = [];
    let resolveSessionRoot: (context: SpanContext) => void = () => {
      throw new Error("Session-root resolver was not initialized");
    };
    const sessionRootPromise = new Promise<SpanContext>((resolve) => {
      resolveSessionRoot = resolve;
    });
    const analytics = new ClientAnalytics({
      projectId: "00000000-0000-4000-8000-000000000001",
      resource: TEST_TELEMETRY.resource,
      sendEventBatch: async (body) => {
        sentBodies.push(body);
        return Result.ok(new Response());
      },
      sendReplayBatch: async () => Result.ok(new Response()),
      getSessionRootContext: async () => await sessionRootPromise,
      replayOptions: { enabled: false },
      productAnalyticsEnabled: true,
      getPropagationPolicy: () => ({ selfOrigin: null, allowedOrigins: [], allowLocalhost: false }),
      integritySignals: false,
      networkCapture: normalizeNetworkCaptureOptions(undefined),
      traceSampleRate: 1,
      shouldIgnoreFetchUrl: () => false,
      errorCapture: { enabled: false, ignoreErrors: [] },
      release: null,
      environment: null,
      sdkVersion: "0.0.0-test",
    });
    const loadPromise = analytics.loadNow();

    try {
      await vi.waitFor(() => expect(analytics.getLoadedTracker()).toBeInstanceOf(EventTracker));
      document.body.innerHTML = "<button id=\"pending-root-click\">Click while identity loads</button>";
      document.querySelector("#pending-root-click")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.dispatchEvent(new Event("pagehide"));

      await vi.waitFor(() => expect(sentBodies.length).toBeGreaterThan(0));
      expect(sentBodies.join("\n")).toContain('"event_type":"$click"');
      expect(sentBodies.join("\n")).toContain('"span_type":"$page-view"');
    } finally {
      resolveSessionRoot({ traceId: "a".repeat(32), spanId: "b".repeat(16) });
      await loadPromise;
      analytics.getLoadedTracker()?.stop();
    }
  });

  it("delivers telemetry tracked before the runtime loads (pre-load buffering)", async () => {
    const trackSpy = vi.spyOn(EventTracker.prototype, "trackCustomEvent").mockImplementation(async () => {});
    vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SessionRecorder.prototype, "start").mockImplementation(() => {});

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      telemetry: TEST_TELEMETRY,
    });
    stubSessionRootContext(app);

    // Fire before the lazy module has any chance to load; the promise must
    // settle only once the loaded tracker accepted the event.
    const tracked = app.trackEvent("pre_load_event", { n: 1 });
    expect(trackSpy).not.toHaveBeenCalled();
    await tracked;
    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy.mock.calls[0][0]).toBe("pre_load_event");
    expect(trackSpy.mock.calls[0][1]).toEqual({ n: 1 });
    // Adoption pins the timestamp captured at call time.
    expect(trackSpy.mock.calls[0][3]?.eventAtMs).toBeTypeOf("number");
  });

  it("captures SDK API calls while suppressing only recursive telemetry delivery", () => {
    const shouldIgnore = (url: string) => shouldIgnoreTelemetryDeliveryUrl(
      url,
      "https://api.example.test/hexclave",
    );

    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/auth/oauth/token")).toBe(false);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/users/me")).toBe(false);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/events/batch")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/session-replays/batch")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/events/batch/extra")).toBe(false);
    expect(shouldIgnore("https://customer.example.test/hexclave/api/v1/analytics/events/batch")).toBe(false);
  });
});

describe("pre-load $http-client spans (ClientAnalytics.beginHttpRequestSpan)", () => {
  function makeAnalytics(overrides?: { shouldIgnoreFetchUrl?: (url: string) => boolean }) {
    return new ClientAnalytics({
      projectId: "00000000-0000-4000-8000-000000000001",
      resource: TEST_TELEMETRY.resource,
      sendEventBatch: async () => Result.ok(new Response()),
      sendReplayBatch: async () => Result.ok(new Response()),
      getSessionRootContext: async () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
      replayOptions: { enabled: false },
      productAnalyticsEnabled: true,
      getPropagationPolicy: () => ({ selfOrigin: null, allowedOrigins: [], allowLocalhost: false }),
      integritySignals: false,
      networkCapture: normalizeNetworkCaptureOptions(undefined),
      traceSampleRate: 1,
      shouldIgnoreFetchUrl: overrides?.shouldIgnoreFetchUrl ?? (() => false),
      // These tests are about $http-client spans; keep the global error
      // capture out of the window handlers.
      errorCapture: { enabled: false, ignoreErrors: [] },
      release: null,
      environment: null,
      sdkVersion: "0.0.0-test",
    });
  }

  it("opens spans before the tracker module loads and adopts their rows on arrival", async () => {
    const adopted: SpanUpdateRow[] = [];
    const enqueueSpy = vi.spyOn(EventTracker.prototype, "enqueueSpanUpdate").mockImplementation(async (row) => {
      adopted.push(row);
    });
    vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});

    const analytics = makeAnalytics();
    const handle = analytics.beginHttpRequestSpan({ url: "https://api.example.com/orders?secret=1", method: "GET", transport: "fetch" });
    // Pre-load rows are generation-checked and may be discarded by a sign-in
    // rotation before the lazy tracker owns them, so they cannot be promised as
    // remote parents yet.
    expect(handle?.propagate).toBe(false);
    handle?.end({ status: 503, errored: false, aborted: false, propagated: false });
    expect(enqueueSpy).not.toHaveBeenCalled();

    await analytics.loadNow();
    // Adoption goes through one more await (generation check) per row.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adopted.length).toBeGreaterThan(0);
    const last = adopted[adopted.length - 1];
    expect(last.span_type).toBe("$http-client");
    expect(last.ended_at_ms).toBeTypeOf("number");
    // Pre-load spans predate the tab's first $page-view span.
    expect(last.page_view_span_id).toBeUndefined();
    // A pre-load fetch has nothing ambient to nest under, so it roots its own
    // local trace. Its identity is valid before the tracker arrives, but is not
    // propagated because generation rotation could still discard this row.
    expect(last.parent_span_id).toBeNull();
    expect(isW3cTraceId(last.trace_id)).toBe(true);
    expect(isW3cSpanId(last.span_id)).toBe(true);
    expect(handle?.spanContext).toEqual({ traceId: last.trace_id, spanId: last.span_id });
    expect(last.data).toMatchObject({ method: "GET", url: "https://api.example.com/orders", transport: "fetch", status: 503 });
    expect(last.data).not.toHaveProperty("propagated");
  });

  it("keeps pre-load custom-span propagation correlation-only", async () => {
    const analytics = makeAnalytics();
    const span = analytics.startSpan("checkout");

    const headers = span.getSpanPropagationHeaders();
    expect(headers.traceparent).toBeUndefined();
    expect(headers["x-hexclave-span-context"]).toBeTypeOf("string");

    const completion = span.end();
    await analytics.flush();
    await completion;
  });

  it("clearBuffer (sign-out) drops pre-load http spans instead of delivering them under the next user", async () => {
    const adopted: SpanUpdateRow[] = [];
    vi.spyOn(EventTracker.prototype, "enqueueSpanUpdate").mockImplementation(async (row) => {
      adopted.push(row);
    });
    vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});

    const analytics = makeAnalytics();
    const handle = analytics.beginHttpRequestSpan({ url: "https://api.example.com/orders", method: "GET", transport: "fetch" });
    analytics.clearBuffer();
    handle?.end({ status: 500, errored: false, aborted: false });
    await analytics.loadNow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adopted.filter((row) => row.span_type === "$http-client")).toHaveLength(0);
  });

  it("applies the SDK-own-URL recursion guard pre-load too", () => {
    const analytics = makeAnalytics({ shouldIgnoreFetchUrl: (url) => url.includes("api.hexclave") });
    expect(analytics.beginHttpRequestSpan({ url: "https://api.hexclave.example/batch", method: "POST", transport: "fetch" })).toBeNull();
  });
});
