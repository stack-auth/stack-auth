import { formatTraceparent, isW3cSpanId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { trace as traceApi } from "@hexclave/shared/dist/utils/otel-api";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackServerApp } from "../interfaces/server-app";
import { getServerAppInstrumentation } from "./server-app-impl";
import { resetLibrarySpanBridgeForTesting } from "./library-span-bridge";
import { runWithServerRequestContext, type ServerRequestSpanContext } from "./server-request-context";
import { encodeSpanContextHeader, SPAN_CONTEXT_HEADER, TRACEPARENT_HEADER } from "./span-propagation";

// The caller's `$http-client` fetch, as it arrives on the incoming `traceparent`.
const CLIENT_FETCH = { traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spanId: "bbbbbbbbbbbbbbbb" };
const PAGE_VIEW_SPAN_ID = "6666666666666666";
const SEGMENT_ID = "55555555-5555-4555-8555-555555555555";

describe("server telemetry delivery suppression", () => {
  afterEach(() => {
    resetLibrarySpanBridgeForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not let the collector POST inherit the request being exported", async () => {
    const deliverySpanRecordingStates: boolean[] = [];
    vi.stubGlobal("fetch", (async () => {
      const deliverySpan = traceApi.getTracer("next.js").startSpan("fetch-POST analytics/events/batch");
      deliverySpanRecordingStates.push(deliverySpan.isRecording());
      deliverySpan.end();
      return new Response("{}", { status: 200 });
    }) as typeof fetch);

    const app = new StackServerApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      secretServerKey: "ssk_test",
      baseUrl: "https://api.example.test",
      tokenStore: "memory",
      noAutomaticPrefetch: true,
      telemetry: { resource: { service: { name: "test-server" } } },
    });
    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();
    await instrumentation?.registerLibrarySpanBridge();

    const span = app.startSpan("request-work");
    await span.end();

    expect(deliverySpanRecordingStates).toEqual([false]);
  });
});

/**
 * A request-like object carrying the two propagation headers a browser would
 * send: `traceparent` for hierarchy, `x-hexclave-span-context` for correlation.
 */
function makePropagatingRequest(opts: {
  projectId: string,
  traceparent?: string | null,
  pageViewSpanId?: string,
  sessionReplaySegmentId?: string,
}) {
  const spanContextHeader = encodeSpanContextHeader({
    projectId: opts.projectId,
    ...opts.sessionReplaySegmentId !== undefined ? { sessionReplaySegmentId: opts.sessionReplaySegmentId } : {},
    ...opts.pageViewSpanId !== undefined ? { pageViewSpanId: opts.pageViewSpanId } : {},
  });
  const traceparent = opts.traceparent === undefined
    ? formatTraceparent({ ...CLIENT_FETCH, sampled: true })
    : opts.traceparent;
  return {
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === SPAN_CONTEXT_HEADER) return spanContextHeader;
        if (lower === TRACEPARENT_HEADER) return traceparent;
        return null;
      },
    },
  };
}

describe("getServerAppInstrumentation + $error capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeRealApp() {
    return new StackServerApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      secretServerKey: "ssk_test",
      baseUrl: "https://api.example.test",
      tokenStore: "memory",
      noAutomaticPrefetch: true,
      telemetry: { resource: { service: { name: "test-server" } } },
    });
  }

  it("returns null for structural non-instances (mocks must fail loud at the caller)", () => {
    expect(getServerAppInstrumentation({ withSpan: () => {}, getUser: () => {} })).toBeNull();
    expect(getServerAppInstrumentation(null)).toBeNull();
  });

  it("captures a $error event through the server telemetry buffer with bounded message/stack", async () => {
    const requests: { url: string, body: string }[] = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      // The interface gzips analytics batch bodies (encodeGzipJsonBody →
      // Uint8Array); decode whatever shape arrives back to the JSON string.
      const url = input instanceof Request ? input.url : String(input);
      let body = "";
      const rawBody = init?.body;
      if (typeof rawBody === "string") {
        body = rawBody;
      } else if (rawBody instanceof Uint8Array) {
        body = rawBody.length >= 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b
          ? gunzipSync(rawBody).toString("utf8")
          : new TextDecoder().decode(rawBody);
      } else if (input instanceof Request) {
        body = await input.clone().text();
      }
      requests.push({ url, body });
      return new Response("{}", { status: 200 });
    }) as typeof fetch);

    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();

    const error = new Error(`boom ${"x".repeat(20_000)}`);
    // The returned promise settles with batch delivery, so awaiting it IS the
    // assertion that the buffer flushed.
    await instrumentation?.captureServerRequestError(error, {
      mechanism: "next.onRequestError",
      handled: false,
      data: { path: "/orders", method: "GET" },
    });

    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as { events?: { event_type: string, data: Record<string, unknown> }[] };
    expect(payload.events).toHaveLength(1);
    const event = payload.events?.[0];
    expect(event?.event_type).toBe("$error");
    // Mechanism info is flattened into scalars (mechanism_type/handled) — see
    // buildErrorEventData for why nested objects were rejected.
    expect(event?.data.mechanism_type).toBe("next.onRequestError");
    expect(event?.data.handled).toBe(false);
    expect(typeof event?.data.fingerprint).toBe("string");
    expect(typeof event?.data.sdk_version).toBe("string");
    expect(event?.data.path).toBe("/orders");
    expect(event?.data.name).toBe("Error");
    // Bounded to 8KB, not the 20KB original.
    expect((event?.data.message as string).length).toBeLessThanOrEqual(8_192);
    expect((event?.data.message as string).startsWith("boom ")).toBe(true);
    expect(typeof event?.data.stack).toBe("string");
  });
});

describe("app.logger (server)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeRealApp() {
    return new StackServerApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      secretServerKey: "ssk_test",
      baseUrl: "https://api.example.test",
      tokenStore: "memory",
      noAutomaticPrefetch: true,
      telemetry: { resource: { service: { name: "test-server" } } },
    });
  }

  function stubAnalyticsFetch() {
    const requests: { url: string, body: string }[] = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      let body = "";
      const rawBody = init?.body;
      if (typeof rawBody === "string") {
        body = rawBody;
      } else if (rawBody instanceof Uint8Array) {
        body = rawBody.length >= 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b
          ? gunzipSync(rawBody).toString("utf8")
          : new TextDecoder().decode(rawBody);
      } else if (input instanceof Request) {
        body = await input.clone().text();
      }
      requests.push({ url, body });
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    return requests;
  }

  type SentLogEvent = {
    event_type: string,
    message?: string,
    level?: string,
    data: Record<string, unknown>,
    /** The ENCLOSING span, W3C-style — present only when the item has one. */
    trace_id?: string,
    span_id?: string,
    page_view_span_id?: string,
  };

  function getSentLogPayload(requests: { url: string, body: string }[]) {
    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    return JSON.parse(batchRequest?.body ?? "{}") as {
      user_id?: string,
      session_replay_segment_id?: string,
      events?: SentLogEvent[],
    };
  }

  it("ships a $log event with message + level wire fields through the server buffer", async () => {
    const requests = stubAnalyticsFetch();
    const app = makeRealApp();

    app.logger.warn("cache miss", { key: "user:42" });
    await app.flush();

    const payload = getSentLogPayload(requests);
    expect(payload.events).toHaveLength(1);
    const event = payload.events?.[0];
    expect(event?.event_type).toBe("$log");
    expect(event?.message).toBe("cache miss");
    expect(event?.level).toBe("warn");
    expect(event?.data).toEqual({ key: "user:42" });
  });

  // The headline feature: a customer's `app.logger.info(...)` inside a
  // `withSpan({ request })` scope must automatically join the caller's trace and
  // carry their session/page labels. runWithServerRequestContext is exactly the
  // ambient scope withSpan({ request }) establishes after resolving the
  // request, so driving it directly proves the stamping without needing a full
  // session-resolution fixture.
  it("joins the caller's trace and stamps session + page correlation on logs inside a request scope", async () => {
    const requests = stubAnalyticsFetch();
    const app = makeRealApp();

    const context: ServerRequestSpanContext = {
      userId: "99999999-9999-4999-8999-999999999999",
      refreshTokenId: "44444444-4444-4444-8444-444444444444",
      sessionReplayId: null,
      sessionReplaySegmentId: SEGMENT_ID,
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
      incomingParent: CLIENT_FETCH,
    };
    await runWithServerRequestContext(context, async () => {
      app.logger.info("order created", { order_id: 7 });
      await app.flush();
    });

    const payload = getSentLogPayload(requests);
    expect(payload.user_id).toBe(context.userId);
    expect(payload.session_replay_segment_id).toBe(context.sessionReplaySegmentId);
    expect(payload.events).toHaveLength(1);
    const event = payload.events?.[0];
    expect(event?.event_type).toBe("$log");
    expect(event?.message).toBe("order created");
    expect(event?.level).toBe("info");
    expect(event?.data).toEqual({ order_id: 7 });
    // HIERARCHY: the log's enclosing span is the caller's fetch itself, in the
    // caller's trace — that single pair is what lands the backend log in the
    // same trace as the browser request that caused it.
    expect(event?.trace_id).toBe(CLIENT_FETCH.traceId);
    expect(event?.span_id).toBe(CLIENT_FETCH.spanId);
    // CORRELATION, not ancestry: which page the user was on.
    expect(event?.page_view_span_id).toBe(PAGE_VIEW_SPAN_ID);
  });

  it("an event with no enclosing span carries no trace at all (never a phantom trace root)", async () => {
    const requests = stubAnalyticsFetch();
    const app = makeRealApp();

    // A request that arrived without a usable traceparent: nothing to join.
    await runWithServerRequestContext({
      userId: null,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      pageViewSpanId: null,
      incomingParent: null,
    }, async () => {
      app.logger.info("no enclosing span");
      await app.flush();
    });

    const event = getSentLogPayload(requests).events?.[0];
    // Events are instants: minting a trace id for one would put a lone event in
    // the trace inbox as a root activity, which it is not.
    expect(event?.trace_id).toBeUndefined();
    expect(event?.span_id).toBeUndefined();
  });

  it("drops logs with invalid structured data locally (warn, no send)", async () => {
    const requests = stubAnalyticsFetch();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = makeRealApp();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    app.logger.error("bad data", circular);
    await app.flush();

    expect(requests.find((request) => request.url.includes("analytics"))).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropping error log"));
  });
});

describe("zero-wiring server telemetry", () => {
  const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function makeRealApp(traceSampleRate = 1) {
    return new StackServerApp({
      projectId: PROJECT_ID,
      publishableClientKey: "pck_test",
      secretServerKey: "ssk_test",
      baseUrl: "https://api.example.test",
      tokenStore: "memory",
      noAutomaticPrefetch: true,
      observability: { traceSampleRate },
      telemetry: { resource: { service: { name: "test-server" } } },
    });
  }

  function stubFetch(respond?: (url: string) => Response | null) {
    const requests: { url: string, body: string }[] = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      let body = "";
      const rawBody = init?.body;
      if (typeof rawBody === "string") {
        body = rawBody;
      } else if (rawBody instanceof Uint8Array) {
        body = rawBody.length >= 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b
          ? gunzipSync(rawBody).toString("utf8")
          : new TextDecoder().decode(rawBody);
      } else if (input instanceof Request) {
        body = await input.clone().text();
      }
      requests.push({ url, body });
      return respond?.(url) ?? new Response("{}", { status: 200 });
    }) as typeof fetch);
    return requests;
  }

  function getTelemetryPayloadItemCount(body: string): number {
    const payload: unknown = JSON.parse(body);
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Expected the telemetry payload to be an object");
    }
    const events = "events" in payload ? payload.events : undefined;
    const spans = "spans" in payload ? payload.spans : undefined;
    if (events !== undefined && !Array.isArray(events)) {
      throw new Error("Expected telemetry payload events to be an array");
    }
    if (spans !== undefined && !Array.isArray(spans)) {
      throw new Error("Expected telemetry payload spans to be an array");
    }
    return (events?.length ?? 0) + (spans?.length ?? 0);
  }

  it("samples at the server flush boundary and promotes a complete failed trace", async () => {
    const requests = stubFetch();
    const app = makeRealApp(0);

    const healthy = app.startSpan("healthy-request");
    const healthyEnd = healthy.end();
    await app.flush();
    await healthyEnd;
    expect(requests.find((request) => (
      request.url.includes("analytics") && request.body.includes("healthy-request")
    ))).toBeUndefined();

    const root = app.startSpan("failed-request");
    const child = root.startSpan("database-query", { data: { status_code: "error" } });
    const childEnd = child.end();
    const rootEnd = root.end();
    await app.flush();
    await Promise.all([childEnd, rootEnd]);

    const batchRequest = requests.find((request) => (
      request.url.includes("analytics") && request.body.includes("failed-request")
    ));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as {
      spans?: { span_type: string, trace_id: string, parent_span_id: string | null }[],
    };
    expect(payload.spans?.map((span) => span.span_type).sort()).toEqual(["database-query", "failed-request"]);
    expect(new Set(payload.spans?.map((span) => span.trace_id)).size).toBe(1);
    expect(payload.spans?.find((span) => span.span_type === "database-query")?.parent_span_id).toBe(root.spanId);

    const requestContext: ServerRequestSpanContext = {
      userId: null,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      pageViewSpanId: null,
      incomingParent: CLIENT_FETCH,
    };
    await runWithServerRequestContext(requestContext, async () => {
      app.logger.error("promoted-error-log");
      await app.flush();
    });
    expect(requests.some((request) => (
      request.url.includes("analytics") && request.body.includes("promoted-error-log")
    ))).toBe(true);

    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();
    await runWithServerRequestContext(requestContext, async () => {
      const errorDelivery = instrumentation?.captureServerRequestError(
        new Error("promoted-error-event"),
        { mechanism: "test", handled: false },
      );
      await app.flush();
      await errorDelivery;
    });
    expect(requests.some((request) => (
      request.url.includes("analytics") && request.body.includes("promoted-error-event")
    ))).toBe(true);
  });

  it("never traces its own analytics delivery endpoint across repeated flushes", async () => {
    const requests = stubFetch();
    const app = makeRealApp();

    const span = app.startSpan("customer-operation");
    const spanEnd = span.end();
    await app.flush();
    await spanEnd;

    // If the delivery POST became a $http-client span, each flush would create
    // the work consumed by the next one and this count would keep growing.
    await app.flush();
    await app.flush();

    const analyticsRequests = requests.filter((request) => request.url.includes("analytics/events/batch"));
    expect(analyticsRequests).toHaveLength(1);
    expect(analyticsRequests[0].body).toContain("customer-operation");
    expect(analyticsRequests[0].body).not.toContain("$http-client");
  });

  it("does not advertise a manually pinned server span from a head-dropped trace", async () => {
    stubFetch();
    const app = makeRealApp(0);
    const span = app.startSpan("head-dropped");

    const headers = span.getSpanPropagationHeaders();
    expect(headers[TRACEPARENT_HEADER]).toBeUndefined();
    expect(headers[SPAN_CONTEXT_HEADER]).toBeUndefined();

    const completion = span.end();
    await app.flush();
    await completion;
  });

  it("coalesces sampled server telemetry for one second before one collector POST", async () => {
    vi.useFakeTimers();
    const requests = stubFetch();
    const app = makeRealApp(0);

    const first = app.startSpan("first-failure", { data: { error: "first" } });
    const firstEnd = first.end();
    await vi.advanceTimersByTimeAsync(999);
    expect(requests.find((request) => request.body.includes("first-failure"))).toBeUndefined();

    const second = app.startSpan("second-failure", { data: { error: "second" } });
    const secondEnd = second.end();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([firstEnd, secondEnd]);

    const matchingRequests = requests.filter((request) => (
      request.url.includes("analytics")
      && request.body.includes("first-failure")
      && request.body.includes("second-failure")
    ));
    expect(matchingRequests).toHaveLength(1);
  });

  it("applies the immediate flush threshold after sampling instead of to raw span volume", async () => {
    vi.useFakeTimers();
    const requests = stubFetch();
    const app = makeRealApp(0.1);

    const completions = Array.from({ length: 800 }, (_, index) => {
      const span = app.startSpan(`high-volume-${index}`);
      return span.end();
    });
    await vi.advanceTimersByTimeAsync(999);

    expect(requests.filter((request) => request.url.includes("analytics"))).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(completions);
    expect(requests.filter((request) => request.url.includes("analytics"))).toHaveLength(1);
  });

  it("splits a promoted sampled window into collector-safe payloads", async () => {
    vi.useFakeTimers();
    const requests = stubFetch();
    const app = makeRealApp(0.1);

    const completions = Array.from({ length: 800 }, (_, index) => {
      const span = app.startSpan(`promoted-${index}`, { data: { error: `failure-${index}` } });
      return span.end();
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(completions);

    const payloadItemCounts = requests
      .filter((request) => request.url.includes("analytics"))
      .map((request) => getTelemetryPayloadItemCount(request.body));
    expect(payloadItemCounts).toEqual([400, 400]);
  });

  it("constructing the app installs the outbound fetch instrumentation eagerly ($http-client span, no register() glue)", async () => {
    const requests = stubFetch();
    const app = makeRealApp();

    const response = await globalThis.fetch("https://third-party.example/data");
    expect(response.status).toBe(200);
    await app.flush();

    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as { spans?: { span_type: string, data: Record<string, unknown> }[] };
    expect(payload.spans).toHaveLength(1);
    expect(payload.spans?.[0]?.span_type).toBe("$http-client");
    expect(payload.spans?.[0]?.data.url).toBe("https://third-party.example/data");
  });

  it("honors the framework suppression predicate for SDK-native outbound fetch capture", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();

    let suppressed = true;
    instrumentation?.setTelemetrySuppressionPredicate(() => suppressed);

    // Collector/control-plane work still executes, but must not create SDK
    // telemetry that would enqueue another batch and recursively re-enter the
    // collector route.
    await globalThis.fetch("https://third-party.example/suppressed");
    suppressed = false;
    await globalThis.fetch("https://third-party.example/visible");
    await app.flush();

    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as { spans?: { span_type: string, data: Record<string, unknown> }[] };
    expect(payload.spans).toHaveLength(1);
    expect(payload.spans?.[0]?.span_type).toBe("$http-client");
    expect(payload.spans?.[0]?.data.url).toBe("https://third-party.example/visible");
  });

  it("coalesces span/event updates that cross microtask boundaries into one server batch", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const userId = "00000000-0000-4000-8000-000000000099";

    const first = app.trackEvent("cold_start_work", { step: 1 }, { userId });
    await Promise.resolve();
    const second = app.trackEvent("cold_start_work", { step: 2 }, { userId });
    await Promise.all([first, second]);

    const payloads = requests
      .filter((request) => request.url.includes("analytics"))
      .map((request) => JSON.parse(request.body) as { events?: { event_type: string, data: { step?: number } }[] });
    const matchingPayloads = payloads.filter((payload) => payload.events?.some((event) => event.event_type === "cold_start_work"));
    expect(matchingPayloads).toHaveLength(1);
    const payload = matchingPayloads[0];
    expect(payload.events?.map((event) => event.data.step)).toEqual([1, 2]);
  });

  it("queues a healthy burst behind bounded concurrency and caps memory during an outage", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pendingResponses: { url: string, body: string, resolve: (response: Response) => void }[] = [];
    let release = false;
    const pendingFetch: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const rawBody = init?.body;
      const body = typeof rawBody === "string"
        ? rawBody
        : rawBody instanceof Uint8Array
          ? rawBody.length >= 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b
            ? gunzipSync(rawBody).toString("utf8")
            : new TextDecoder().decode(rawBody)
          : input instanceof Request
            ? await input.clone().text()
            : "";
      if (release) return new Response("{}", { status: 200 });
      return await new Promise<Response>((resolve) => {
        pendingResponses.push({ url, body, resolve });
      });
    };
    vi.stubGlobal("fetch", vi.fn(pendingFetch));
    const app = makeRealApp();

    // Eight sends start immediately, 256 wait in the byte-and-count-bounded
    // queue, and only the 265th is rejected. The old pool dropped the 33rd
    // during ordinary startup bursts instead of giving the collector time to
    // drain.
    const sends = Array.from({ length: 265 }, (_, index) => app.trackEvent(
      "collector_pressure",
      { index },
      { userId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` },
    ));

    await vi.waitFor(() => expect(
      pendingResponses.filter(({ url, body }) => url.includes("analytics") && body.includes("collector_pressure")),
    ).toHaveLength(8));
    await expect(sends[264]).rejects.toThrow("bounded delivery queue is full");
    expect(warnSpy.mock.calls.filter(([message]) => (
      typeof message === "string" && message.includes("bounded delivery queue is full")
    ))).toHaveLength(1);

    release = true;
    for (const { resolve } of pendingResponses) {
      resolve(new Response("{}", { status: 200 }));
    }
    await Promise.all(sends.slice(0, 264));
  });

  it("disables server telemetry for the process after an ANALYTICS_NOT_ENABLED rejection (warn once, no further sends)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests = stubFetch((url) => url.includes("analytics")
      ? new Response(JSON.stringify({ code: "ANALYTICS_NOT_ENABLED" }), { status: 400 })
      : null);
    const app = makeRealApp();

    await expect(app.trackEvent("checkout_completed")).rejects.toThrow(/ANALYTICS_NOT_ENABLED/);
    const analyticsSendCount = requests.filter((request) => (
      request.url.includes("analytics") && request.body.includes("checkout_completed")
    )).length;
    expect(analyticsSendCount).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    const disabledWarnCount = warnSpy.mock.calls.filter(([message]) => (
      typeof message === "string" && message.includes("disabled for this process")
    )).length;
    expect(disabledWarnCount).toBeGreaterThanOrEqual(1);

    // Sticky: later telemetry rejects locally without another doomed send.
    await expect(app.trackEvent("checkout_completed")).rejects.toThrow(/not enabled/);
    expect(requests.filter((request) => (
      request.url.includes("analytics") && request.body.includes("checkout_completed")
    )).length).toBe(analyticsSendCount);
    expect(warnSpy.mock.calls.filter(([message]) => (
      typeof message === "string" && message.includes("disabled for this process")
    ))).toHaveLength(disabledWarnCount);
  });

  it("bare trackEvent adopts the framework's ambient request (session + incoming trace, zero threading)", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();

    const ambientRequest = makePropagatingRequest({
      projectId: PROJECT_ID,
      sessionReplaySegmentId: SEGMENT_ID,
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
    });
    instrumentation?.setAmbientRequestProvider(async () => ambientRequest);

    await app.trackEvent("checkout_completed", { amount: 42 });

    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as {
      session_replay_segment_id?: string,
      events?: { event_type: string, trace_id?: string, span_id?: string, page_view_span_id?: string }[],
    };
    expect(payload.session_replay_segment_id).toBe(SEGMENT_ID);
    expect(payload.events).toHaveLength(1);
    expect(payload.events?.[0]?.event_type).toBe("checkout_completed");
    // The incoming `traceparent` is the outermost ambient parent, so a bare
    // trackEvent lands inside the caller's trace under the caller's fetch.
    expect(payload.events?.[0]?.trace_id).toBe(CLIENT_FETCH.traceId);
    expect(payload.events?.[0]?.span_id).toBe(CLIENT_FETCH.spanId);
    expect(payload.events?.[0]?.page_view_span_id).toBe(PAGE_VIEW_SPAN_ID);
  });

  it("honors an upstream sampled trace even when the server's local sample rate is zero", async () => {
    const requests = stubFetch();
    const app = makeRealApp(0);
    const instrumentation = getServerAppInstrumentation(app);
    instrumentation?.setAmbientRequestProvider(async () => makePropagatingRequest({
      projectId: PROJECT_ID,
      sessionReplaySegmentId: SEGMENT_ID,
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
    }));

    await app.withSpan("upstream-sampled-request", async () => {});
    await app.flush();

    const payload = requests
      .filter((request) => request.url.includes("analytics"))
      .map((request) => JSON.parse(request.body) as {
        spans?: { span_type: string, trace_id: string, parent_span_id: string | null }[],
      })
      .find((candidate) => candidate.spans?.some((span) => span.span_type === "upstream-sampled-request"));
    const span = payload?.spans?.find((candidate) => candidate.span_type === "upstream-sampled-request");
    expect(span).toMatchObject({
      trace_id: CLIENT_FETCH.traceId,
      parent_span_id: CLIENT_FETCH.spanId,
    });
  });

  it("rejects an unsampled incoming traceparent instead of storing a missing parent", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);

    // flags `00` explicitly does not promise that the caller recorded its span.
    // Joining it would put a permanent unknown-parent placeholder in the tree.
    instrumentation?.setAmbientRequestProvider(async () => makePropagatingRequest({
      projectId: PROJECT_ID,
      traceparent: formatTraceparent({ ...CLIENT_FETCH, sampled: false }),
    }));

    await app.trackEvent("checkout_completed");

    const payload = requests
      .filter((request) => request.url.includes("analytics"))
      .map((request) => JSON.parse(request.body) as {
        events?: { event_type: string, trace_id?: string, span_id?: string }[],
      })
      .find((candidate) => candidate.events?.some((event) => event.event_type === "checkout_completed"));
    expect(payload?.events?.[0]?.trace_id).toBeUndefined();
    expect(payload?.events?.[0]?.span_id).toBeUndefined();
  });

  it("bare withSpan adopts the ambient request; a provider returning null degrades to plain telemetry", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);

    let insideRequestScope = true;
    instrumentation?.setAmbientRequestProvider(async () => insideRequestScope
      ? makePropagatingRequest({ projectId: PROJECT_ID, sessionReplaySegmentId: SEGMENT_ID })
      : null);

    await app.withSpan("process-order", async () => {});
    await app.flush();

    type WireSpan = { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null };
    const withContext = JSON.parse(requests.find((request) => request.url.includes("analytics"))?.body ?? "{}") as {
      session_replay_segment_id?: string,
      spans?: WireSpan[],
    };
    expect(withContext.session_replay_segment_id).toBe(SEGMENT_ID);
    const processOrder = withContext.spans?.find((span) => span.span_type === "process-order");
    expect(processOrder).not.toBeUndefined();
    expect(processOrder?.trace_id).toBe(CLIENT_FETCH.traceId);
    expect(processOrder?.parent_span_id).toBe(CLIENT_FETCH.spanId);

    // Outside a request scope the provider returns null — telemetry still
    // works, just without request ancestry (and without warning: null is a
    // normal state, not an error).
    requests.length = 0;
    insideRequestScope = false;
    await app.withSpan("background-job", async () => {});
    await app.flush();
    const withoutContext = JSON.parse(requests.find((request) => request.url.includes("analytics"))?.body ?? "{}") as {
      session_replay_segment_id?: string,
      spans?: WireSpan[],
    };
    expect(withoutContext.session_replay_segment_id).toBeUndefined();
    const backgroundJob = withoutContext.spans?.find((span) => span.span_type === "background-job");
    expect(backgroundJob).not.toBeUndefined();
    // With nothing ambient it roots its OWN trace, in a trace that is not the
    // client's, so an unrelated background job never shows up inside a request.
    expect(backgroundJob?.parent_span_id).toBeNull();
    expect(isW3cTraceId(backgroundJob?.trace_id)).toBe(true);
    expect(backgroundJob?.trace_id).not.toBe(CLIENT_FETCH.traceId);
    expect(isW3cSpanId(backgroundJob?.span_id)).toBe(true);
  });
});
