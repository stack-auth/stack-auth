// @vitest-environment jsdom

import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { isW3cSpanId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { Result } from "@hexclave/shared/dist/utils/results";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackClientApp } from "../interfaces/client-app";
import { ClientAnalytics } from "./client-analytics";
import { resetManagedBrowserOtelForTesting } from "./browser-otel-sdk";
import { shouldIgnoreTelemetryDeliveryUrl } from "./client-app-impl";
import { EventTracker } from "./event-tracker";
import { normalizeNetworkCaptureOptions } from "./network-capture";
import { SessionRecorder } from "./session-replay";
import type { SpanContext } from "./telemetry-core";

const TEST_TELEMETRY = { resource: { service: { name: "test-client" } } } as const;
const loggerProviders: LoggerProvider[] = [];

function installExistingProvider(): void {
  if (!trace.setGlobalTracerProvider(new BasicTracerProvider())) {
    throw new Error("Test could not install its existing OTel provider");
  }
}

afterEach(async () => {
  await resetManagedBrowserOtelForTesting();
  await Promise.all(loggerProviders.splice(0).map(async (provider) => await provider.shutdown()));
  logs.disable();
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

  it("defaults omitted root trace sampling to 10%", () => {
    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      automaticSideEffects: false,
      devTool: false,
      telemetry: TEST_TELEMETRY,
    });

    expect(Reflect.get(app, "_traceSampleRate")).toBe(0.1);
  });

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

  it("waits for the session root before starting page-view capture", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);
    let resolveSessionRoot: (context: SpanContext) => void = () => {
      throw new Error("Session-root resolver was not initialized");
    };
    const sessionRootPromise = new Promise<SpanContext>((resolve) => {
      resolveSessionRoot = resolve;
    });
    const analytics = new ClientAnalytics({
      projectId: "00000000-0000-4000-8000-000000000001",
      resource: TEST_TELEMETRY.resource,
      sendReplayBatch: async () => Result.ok(new Response()),
      getSessionRootContext: async () => await sessionRootPromise,
      replayOptions: { enabled: false },
      productAnalyticsEnabled: true,
      getPropagationPolicy: () => ({ selfOrigin: null, allowedOrigins: [], allowLocalhost: false }),
      integritySignals: false,
      networkCapture: normalizeNetworkCaptureOptions(undefined),
      traceSampleRate: 1,
      errorCapture: { enabled: false, ignoreErrors: [] },
      release: null,
      environment: null,
      sdkVersion: "0.0.0-test",
      analyticsBaseUrl: "https://api.example.test",
      openTelemetryProvider: "existing-provider",
      getOtlpRequestHeaders: async () => ({}),
    });
    const loadPromise = analytics.loadNow();

    try {
      await Promise.resolve();
      expect(analytics.getLoadedTracker()).toBeNull();

      const sessionRoot = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
      resolveSessionRoot(sessionRoot);
      await loadPromise;

      const tracker = analytics.getLoadedTracker();
      expect(tracker).toBeInstanceOf(EventTracker);
      const pageViewSpanId = tracker?.getCurrentPageViewSpanId();
      if (pageViewSpanId === null || pageViewSpanId === undefined) {
        throw new Error("Expected the tracker to start with a page-view span");
      }
      expect(pageViewSpanId).toMatch(/^[0-9a-f]{16}$/);
      const ambient = tracker?.getAmbientOtelContext();
      if (ambient === null || ambient === undefined) {
        throw new Error("Expected the page-view ambient context after session-root resolution");
      }
      const ambientSpanContext = trace.getSpanContext(ambient);
      if (ambientSpanContext === undefined) {
        throw new Error("Expected the page-view ambient context to contain a span");
      }
      expect(ambientSpanContext).toMatchObject({
        traceId: sessionRoot.traceId,
        spanId: pageViewSpanId,
      });

      document.body.innerHTML = "<button id=\"rooted-click\">Click after identity loads</button>";
      document.querySelector("#rooted-click")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.dispatchEvent(new Event("pagehide"));
      await loggerProvider.forceFlush();

      expect(exporter.getFinishedLogRecords().map((record) => record.eventName)).toContain("$click");
    } finally {
      if (analytics.getLoadedTracker() === null) {
        resolveSessionRoot({ traceId: "a".repeat(32), spanId: "b".repeat(16) });
      }
      await loadPromise;
      analytics.getLoadedTracker()?.stop();
    }
  });

  it("uses a cached session root during the lazy tracker window", () => {
    const cachedSessionRoot = {
      traceId: "c".repeat(32),
      spanId: "d".repeat(16),
    };
    const getCachedSessionRootContext = vi.fn(() => cachedSessionRoot);
    const analytics = new ClientAnalytics({
      projectId: "00000000-0000-4000-8000-000000000001",
      resource: TEST_TELEMETRY.resource,
      sendReplayBatch: async () => Result.ok(new Response()),
      getSessionRootContext: async () => cachedSessionRoot,
      getCachedSessionRootContext,
      replayOptions: { enabled: false },
      productAnalyticsEnabled: true,
      getPropagationPolicy: () => ({ selfOrigin: null, allowedOrigins: [], allowLocalhost: false }),
      integritySignals: false,
      networkCapture: normalizeNetworkCaptureOptions(undefined),
      traceSampleRate: 1,
      errorCapture: { enabled: false, ignoreErrors: [] },
      release: null,
      environment: null,
      sdkVersion: "0.0.0-test",
      analyticsBaseUrl: "https://api.example.test",
      openTelemetryProvider: "managed",
      getOtlpRequestHeaders: async () => ({}),
    });

    expect(getCachedSessionRootContext).toHaveBeenCalledOnce();
    expect(Reflect.get(analytics, "_resolvedSessionRoot")).toEqual(cachedSessionRoot);
  });

  it("emits trackEvent through OTel without waiting for the legacy runtime", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);
    vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SessionRecorder.prototype, "start").mockImplementation(() => {});

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      observability: { openTelemetry: { provider: "existing-provider" } },
      telemetry: TEST_TELEMETRY,
    });
    stubSessionRootContext(app);

    await app.trackEvent("pre_load_event", { n: 1 });
    await loggerProvider.forceFlush();
    expect(exporter.getFinishedLogRecords()).toMatchObject([{
      eventName: "pre_load_event",
      attributes: {
        "hexclave.signal.type": "event",
        "hexclave.data": { n: 1 },
      },
    }]);
  });

  it("captures exceptions, messages, and normalized events with scoped enrichment and event IDs", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      observability: { openTelemetry: { provider: "existing-provider" } },
      telemetry: TEST_TELEMETRY,
    });
    stubSessionRootContext(app);

    const exceptionEventId = app.withErrorScope((scope) => {
      scope.setUser({ id: "user-123" });
      scope.setTag("area", "checkout");
      scope.setContext("payment", { provider: "test" });
      scope.setExtra("attempt", 2);
      scope.setExtras({ attempt: 3, paymentMethod: "card" });
      scope.addBreadcrumb({ category: "button", message: "Pay clicked", level: "info" });
      return app.captureException(new Error("payment failed"), { handled: true });
    });
    const messageEventId = app.captureMessage("payment degraded", { level: "warning" });
    const normalizedEventId = app.captureEvent({
      message: "normalized failure",
      name: "NormalizedError",
      stack: "NormalizedError: normalized failure\n    at checkout (checkout.js:10:2)",
      handled: false,
    });
    expect(exceptionEventId).toMatch(/^[0-9a-f]{32}$/);
    expect(messageEventId).toMatch(/^[0-9a-f]{32}$/);
    expect(normalizedEventId).toMatch(/^[0-9a-f]{32}$/);
    expect(app.lastEventId()).toBe(normalizedEventId);
    await loggerProvider.forceFlush();

    const records = exporter.getFinishedLogRecords().filter((record) => record.eventName === "$error");
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      attributes: {
        "hexclave.data": {
          event_id: exceptionEventId,
          message: "payment failed",
          handled: true,
          user: { id: "user-123" },
          tags: { area: "checkout" },
          contexts: { payment: { provider: "test" } },
          extra: { attempt: 3, paymentMethod: "card" },
          breadcrumbs: [{ category: "button", message: "Pay clicked", level: "info" }],
        },
        "hexclave.event.id": exceptionEventId,
      },
    });
    expect(records[1]).toMatchObject({ attributes: { "hexclave.data": { event_id: messageEventId, level: "warning", name: "Message" } } });
    expect(records[2]).toMatchObject({ attributes: { "hexclave.data": { event_id: normalizedEventId, name: "NormalizedError", handled: false } } });
  });

  it("keeps explicit capture available when automatic side effects are disabled", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      automaticSideEffects: false,
      devTool: false,
      observability: { openTelemetry: { provider: "existing-provider" } },
      telemetry: TEST_TELEMETRY,
    });

    const analytics = Reflect.get(app, "_clientAnalytics");
    if (!(analytics instanceof ClientAnalytics)) throw new Error("Expected the explicit telemetry facade");
    expect(analytics.getErrorCapture()).toBeNull();
    expect(app.lastEventId()).toBeUndefined();
    const eventId = app.captureMessage("explicit-only capture");
    expect(eventId).toMatch(/^[0-9a-f]{32}$/);
    expect(app.lastEventId()).toBe(eventId);
    expect(analytics.getErrorCapture()).not.toBeNull();
    const result = app.withErrorScope((scope) => {
      scope.setTag("mode", "explicit-only");
      return "sync-result";
    });
    expect(result).toBe("sync-result");
    await expect(app.withErrorScopeAsync(async (scope) => {
      scope.setTag("mode", "explicit-only-async");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return app.captureMessage("async-scoped capture");
    })).resolves.toMatch(/^[0-9a-f]{32}$/);
    await loggerProvider.forceFlush();
    expect(exporter.getFinishedLogRecords().filter((record) => record.eventName === "$error")).toHaveLength(2);
    expect(exporter.getFinishedLogRecords().at(-1)).toMatchObject({
      attributes: { "hexclave.data": { tags: { mode: "explicit-only-async" } } },
    });
    analytics.uninstallErrorIntegrations();
    expect(analytics.getErrorCapture()).toBeNull();
  });

  it("bridges the existing console hook into bounded error breadcrumbs", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000003",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      observability: {
        openTelemetry: { provider: "existing-provider" },
        logs: { captureConsole: ["warn"] },
      },
      telemetry: TEST_TELEMETRY,
    });
    const analytics = Reflect.get(app, "_clientAnalytics");
    if (!(analytics instanceof ClientAnalytics)) throw new Error("Expected the browser telemetry facade");

    console.warn("breadcrumb warning");
    const eventId = app.captureMessage("message after console activity");
    await loggerProvider.forceFlush();

    const error = exporter.getFinishedLogRecords().find((record) =>
      record.eventName === "$error" && record.attributes["hexclave.event.id"] === eventId,
    );
    expect(error).toMatchObject({
      attributes: {
        "hexclave.data": {
          breadcrumbs: [{ category: "console", level: "warning", data: { logger: "console" } }],
        },
      },
    });

    analytics.uninstallErrorIntegrations();
    expect(analytics.getErrorCapture()).toBeNull();
  });

  it("waits for async beforeSend processing during flush and preserves the event ID", async () => {
    installExistingProvider();
    const exporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    loggerProviders.push(loggerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);
    let releaseProcessor: () => void = () => {
      throw new Error("beforeSend release was used before initialization");
    };
    const processorGate = new Promise<void>((resolve) => {
      releaseProcessor = resolve;
    });

    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      automaticSideEffects: false,
      devTool: false,
      observability: {
        openTelemetry: { provider: "existing-provider" },
        errorCapture: {
          beforeSend: async (event) => {
            await processorGate;
            return { ...event, message: "processed before delivery" };
          },
        },
      },
      telemetry: TEST_TELEMETRY,
    });

    const eventId = app.captureMessage("original message");
    const flush = app.flush();
    await Promise.resolve();
    expect(exporter.getFinishedLogRecords()).toHaveLength(0);
    releaseProcessor();
    await flush;

    expect(exporter.getFinishedLogRecords()).toMatchObject([{
      eventName: "$error",
      attributes: {
        "hexclave.event.id": eventId,
        "hexclave.data": { event_id: eventId, message: "processed before delivery" },
      },
    }]);
  });

  it("fails loudly when manual error capture is disabled", () => {
    const app = new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
      analytics: { enabled: true, replays: { enabled: false } },
      observability: { enabled: false },
      telemetry: TEST_TELEMETRY,
    });

    expect(() => app.captureMessage("should not disappear")).toThrow("observability is disabled");
  });

  it("captures SDK API calls while suppressing only recursive telemetry delivery", () => {
    const shouldIgnore = (url: string) => shouldIgnoreTelemetryDeliveryUrl(
      url,
      "https://api.example.test/hexclave",
    );

    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/auth/oauth/token")).toBe(false);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/users/me")).toBe(false);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/events/batch")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/otlp/v1/traces")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/otlp/v1/logs")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/otlp/v1/metrics")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/session-replays/batch")).toBe(true);
    expect(shouldIgnore("https://api.example.test/hexclave/api/v1/analytics/events/batch/extra")).toBe(false);
    expect(shouldIgnore("https://customer.example.test/hexclave/api/v1/analytics/events/batch")).toBe(false);
  });
});
