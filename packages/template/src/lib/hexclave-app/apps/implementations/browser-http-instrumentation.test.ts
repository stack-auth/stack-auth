// @vitest-environment jsdom

import { context, propagation, ROOT_CONTEXT, trace, TraceFlags, type Context } from "@opentelemetry/api";
import { HEXCLAVE_PAGE_VIEW_SPAN_ID_BAGGAGE_KEY, HEXCLAVE_SESSION_REPLAY_SEGMENT_ID_BAGGAGE_KEY } from "@hexclave/shared/dist/utils/span-context-codec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerManagedBrowserOtel, resetManagedBrowserOtelForTesting, type BrowserManagedOtelOptions } from "./browser-otel-sdk";

afterEach(async () => {
  await resetManagedBrowserOtelForTesting();
  vi.unstubAllGlobals();
});

function stubNativeFetch() {
  const nativeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", nativeFetch);
  return nativeFetch;
}

function registerWithAmbient(
  getAmbientOtelContext: BrowserManagedOtelOptions["getAmbientOtelContext"],
  options: Pick<BrowserManagedOtelOptions, "installHttpInstrumentationImmediately"> = {},
) {
  return registerManagedBrowserOtel({
    analyticsBaseUrl: "https://telemetry.example.test",
    projectId: "project",
    clientVersion: "test",
    traceSampleRate: 1,
    resource: { service: { name: "storefront" } },
    getRequestHeaders: async () => ({ "x-hexclave-access-token": "token" }),
    networkCapture: { enabled: true, allowOrigins: null, denyOrigins: null, ignoreUrls: [] },
    getPropagationPolicy: () => ({ allowedOrigins: [], allowLocalhost: false }),
    getAmbientOtelContext,
    ...options,
  });
}

function requestHeaders(nativeFetch: ReturnType<typeof stubNativeFetch>, callIndex: number): Headers {
  const init = nativeFetch.mock.calls[callIndex]?.[1];
  return new Headers(init?.headers);
}

// `@opentelemetry/instrumentation-fetch` delays `span.end()` by 300ms so a
// PerformanceObserver can attach resource timings. HTTP client metrics are
// recorded in `SpanProcessor.onEnd`, so they cannot appear until that timer
// fires. The drop-path test waits too: otherwise a missing export could just
// mean the span has not ended yet.
const FETCH_SPAN_END_DELAY_MS = 350;

async function waitForFetchSpanEnd(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, FETCH_SPAN_END_DELAY_MS);
  });
}

const SESSION_TRACE_ID = "abfa79547286426fa8079a0070399027";
const PAGE_VIEW_SPAN_ID = "56a1e66c121ef299";
const SEGMENT_ID = "22222222-2222-4222-8222-222222222222";

function pageViewAmbientContext(traceId = SESSION_TRACE_ID): Context {
  const withSpan = trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: PAGE_VIEW_SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
  });
  return propagation.setBaggage(withSpan, propagation.createBaggage({
    [HEXCLAVE_SESSION_REPLAY_SEGMENT_ID_BAGGAGE_KEY]: { value: SEGMENT_ID },
    [HEXCLAVE_PAGE_VIEW_SPAN_ID_BAGGAGE_KEY]: { value: PAGE_VIEW_SPAN_ID },
  }));
}

describe("managed browser HTTP instrumentation", () => {
  it("exports HTTP client metrics from the recorded request span", async () => {
    const nativeFetch = stubNativeFetch();
    const registration = registerWithAmbient(() => null);

    await fetch(window.location.origin + "/orders");
    await waitForFetchSpanEnd();
    await registration.forceFlush();

    const metricCall = nativeFetch.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith("/v1/metrics"));
    if (metricCall === undefined) throw new Error("expected a native OTLP metrics export");
    const body = metricCall[1]?.body;
    if (!(body instanceof Uint8Array)) throw new Error("native OTLP metrics body should be JSON bytes");
    const payload: unknown = JSON.parse(new TextDecoder().decode(body));
    expect(payload).toMatchObject({ resourceMetrics: [{ scopeMetrics: [{ metrics: expect.any(Array) }] }] });
    expect(JSON.stringify(payload)).toContain('"name":"hexclave.http.client.request.count"');
    expect(JSON.stringify(payload)).toContain('"name":"hexclave.http.client.request.duration"');
  });

  it("does not export HTTP client metrics for a head-dropped request span", async () => {
    const nativeFetch = stubNativeFetch();
    const registration = registerManagedBrowserOtel({
      analyticsBaseUrl: "https://telemetry.example.test",
      projectId: "project",
      clientVersion: "test",
      traceSampleRate: 0,
      resource: { service: { name: "storefront" } },
      getRequestHeaders: async () => ({ "x-hexclave-access-token": "token" }),
      networkCapture: { enabled: true, allowOrigins: null, denyOrigins: null, ignoreUrls: [] },
      getPropagationPolicy: () => ({ allowedOrigins: [], allowLocalhost: false }),
      getAmbientOtelContext: () => null,
    });

    await fetch(window.location.origin + "/orders");
    await waitForFetchSpanEnd();
    await registration.forceFlush();

    const metricCall = nativeFetch.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith("/v1/metrics"));
    const payload = metricCall === undefined
      ? ""
      : new TextDecoder().decode(metricCall[1]?.body instanceof Uint8Array ? metricCall[1].body : new Uint8Array());
    expect(payload).not.toContain('"name":"hexclave.http.client.request.count"');
    expect(payload).not.toContain('"name":"hexclave.http.client.request.duration"');
  });

  it("lets official fetch instrumentation own W3C injection", async () => {
    const nativeFetch = stubNativeFetch();
    registerWithAmbient(() => null);

    await fetch(window.location.origin + "/orders");

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(requestHeaders(nativeFetch, 0).get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("does not create request spans for client reports or attachment uploads", async () => {
    const nativeFetch = stubNativeFetch();
    registerWithAmbient(() => pageViewAmbientContext());

    await fetch("https://telemetry.example.test/api/v1/analytics/client-reports");
    await fetch("https://telemetry.example.test/api/v1/analytics/attachments");

    const deliveryRequests = nativeFetch.mock.calls.filter(([input]) => {
      const pathname = new URL(String(input)).pathname;
      return pathname === "/api/v1/analytics/client-reports" || pathname === "/api/v1/analytics/attachments";
    });
    expect(deliveryRequests).toHaveLength(2);
    expect(deliveryRequests.every(([, init]) => new Headers(init?.headers).get("traceparent") === null)).toBe(true);
  });

  // Regression test: with a plain StackContextManager, app-initiated fetches
  // (which never run inside a `context.with(...)` frame) saw ROOT_CONTEXT, so
  // every fetch minted a fresh parentless trace — detaching the whole request +
  // backend subtree from the refresh-token session trace.
  it("parents app-initiated fetches under the ambient page-view context", async () => {
    const nativeFetch = stubNativeFetch();
    let ambient: Context | null = null;
    registerWithAmbient(() => ambient);

    // Before the first page view there is no ambient: the fetch roots its own trace.
    await fetch(window.location.origin + "/pre-page-view");
    ambient = pageViewAmbientContext();
    await fetch(window.location.origin + "/orders");

    const preAmbient = requestHeaders(nativeFetch, 0).get("traceparent");
    expect(preAmbient).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(preAmbient).not.toContain(SESSION_TRACE_ID);

    const joined = requestHeaders(nativeFetch, 1);
    const traceparent = joined.get("traceparent");
    // Same trace as the session, but a CHILD span id (the fetch span), never
    // the page view's own id verbatim.
    expect(traceparent).toMatch(new RegExp(`^00-${SESSION_TRACE_ID}-[0-9a-f]{16}-01$`));
    expect(traceparent).not.toContain(PAGE_VIEW_SPAN_ID);
    // The correlation baggage rides too, so the backend can stamp
    // page_view_span_id / segment id on everything downstream.
    const baggage = joined.get("baggage") ?? "";
    expect(baggage).toContain(`${HEXCLAVE_PAGE_VIEW_SPAN_ID_BAGGAGE_KEY}=${PAGE_VIEW_SPAN_ID}`);
    expect(baggage).toContain(HEXCLAVE_SESSION_REPLAY_SEGMENT_ID_BAGGAGE_KEY);
  });

  it("can gate HTTP instrumentation until the authenticated session root is ready", async () => {
    const nativeFetch = stubNativeFetch();
    const registration = registerWithAmbient(() => pageViewAmbientContext(), {
      installHttpInstrumentationImmediately: false,
    });

    // There is no safe hierarchy to export yet. The request still runs, but
    // the managed registration has not installed its HTTP instrumentations, so
    // it cannot create a random root that cannot be reparented later. The
    // explicit return value also makes this assertion independent of any
    // wrapper left by jsdom or another test's global fetch implementation.
    await fetch(window.location.origin + "/bootstrap");

    expect(registration.enableHttpInstrumentation()).toBe(true);
    expect(registration.enableHttpInstrumentation()).toBe(false);
    await fetch(window.location.origin + "/orders");
    expect(requestHeaders(nativeFetch, nativeFetch.mock.calls.length - 1).get("traceparent")).toMatch(new RegExp(`^00-${SESSION_TRACE_ID}-[0-9a-f]{16}-01$`));
  });

  it("rebinds a shared provider without reusing a prior instance's ambient closure or gate", async () => {
    const nativeFetch = stubNativeFetch();
    const first = registerWithAmbient(() => pageViewAmbientContext(SESSION_TRACE_ID));
    const second = registerWithAmbient(() => pageViewAmbientContext("cd".repeat(16)), {
      installHttpInstrumentationImmediately: false,
    });

    expect(second).not.toBe(first);
    // The first instance is no longer allowed to release the second instance's
    // startup gate after the singleton has been claimed again.
    expect(first.enableHttpInstrumentation()).toBe(false);
    await fetch(window.location.origin + "/bootstrap");
    expect(requestHeaders(nativeFetch, 0).get("traceparent")).toBeNull();

    expect(second.enableHttpInstrumentation()).toBe(true);
    await fetch(window.location.origin + "/orders");

    expect(requestHeaders(nativeFetch, 1).get("traceparent")).toMatch(new RegExp(`^00-${"cd".repeat(16)}-[0-9a-f]{16}-01$`));
  });

  it("lets an explicit context frame win over the ambient base", async () => {
    const nativeFetch = stubNativeFetch();
    registerWithAmbient(() => pageViewAmbientContext());
    const explicitTraceId = "f6933251b32c452797efd049d81aff4a";
    const explicit = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: explicitTraceId,
      spanId: "97efd049d81aff4a",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    });

    await context.with(explicit, async () => {
      await fetch(window.location.origin + "/orders");
    });

    const traceparent = requestHeaders(nativeFetch, 0).get("traceparent");
    expect(traceparent).toMatch(new RegExp(`^00-${explicitTraceId}-[0-9a-f]{16}-01$`));
  });
});
