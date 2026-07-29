import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackServerApp } from "../interfaces/server-app";
import { getServerAppInstrumentation, httpClientSpanIdForServerItem } from "./server-app-impl";
import { runWithServerRequestContext, type ServerRequestSpanContext } from "./server-request-context";
import { encodeSpanContextHeader, SPAN_CONTEXT_HEADER } from "./span-propagation";

const HTTP_CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_PARENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_PARENT_B = "22222222-2222-4222-8222-222222222222";
const SERVER_SPAN = "33333333-3333-4333-8333-333333333333";

function makeContext(overrides?: Partial<ServerRequestSpanContext>): ServerRequestSpanContext {
  return {
    userId: null,
    refreshTokenId: null,
    sessionReplayId: null,
    sessionReplaySegmentId: null,
    pageViewSpanId: null,
    httpClientSpanId: HTTP_CLIENT,
    customParentSpanIds: [CLIENT_PARENT_A, CLIENT_PARENT_B],
    ...overrides,
  };
}

describe("httpClientSpanIdForServerItem (nearest-known-ancestor contract)", () => {
  it("qualifies items whose entire custom chain came from the propagation header", () => {
    // The root withSpan({ request }) span: parents = exactly the header chain.
    expect(httpClientSpanIdForServerItem(makeContext(), [CLIENT_PARENT_A, CLIENT_PARENT_B])).toBe(HTTP_CLIENT);
    // A request-level event under a partial header chain still qualifies.
    expect(httpClientSpanIdForServerItem(makeContext(), [CLIENT_PARENT_B])).toBe(HTTP_CLIENT);
    // No custom parents at all (header had none): the fetch is the nearest ancestor.
    expect(httpClientSpanIdForServerItem(makeContext({ customParentSpanIds: [] }), [])).toBe(HTTP_CLIENT);
  });

  it("omits the id once a server-opened span enters the chain (it sits between fetch and item)", () => {
    expect(httpClientSpanIdForServerItem(makeContext(), [CLIENT_PARENT_A, CLIENT_PARENT_B, SERVER_SPAN])).toBeNull();
    expect(httpClientSpanIdForServerItem(makeContext(), [SERVER_SPAN])).toBeNull();
  });

  it("returns null when the request carried no http-client span", () => {
    expect(httpClientSpanIdForServerItem(makeContext({ httpClientSpanId: null }), [CLIENT_PARENT_A])).toBeNull();
  });
});

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
    parent_span_ids?: string[],
    page_view_span_id?: string,
    http_client_span_id?: string,
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
  // `withSpan({ request })` scope must automatically link to the caller's
  // session/page/fetch ancestry. runWithServerRequestContext is exactly the
  // ambient scope withSpan({ request }) establishes after resolving the
  // request, so driving it directly proves the parent stamping without
  // needing a full session-resolution fixture.
  it("stamps ambient request ancestry (session, page view, fetch span, parents) on logs inside a request scope", async () => {
    const requests = stubAnalyticsFetch();
    const app = makeRealApp();

    const context: ServerRequestSpanContext = {
      userId: "99999999-9999-4999-8999-999999999999",
      refreshTokenId: "44444444-4444-4444-8444-444444444444",
      sessionReplayId: null,
      sessionReplaySegmentId: "55555555-5555-4555-8555-555555555555",
      pageViewSpanId: "66666666-6666-4666-8666-666666666666",
      httpClientSpanId: HTTP_CLIENT,
      customParentSpanIds: [CLIENT_PARENT_A, CLIENT_PARENT_B],
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
    // The client-propagated custom chain becomes the log's parents, the page
    // view rides per-item, and — because the entire chain came from the
    // propagation header — the fetch bridge span qualifies as nearest known
    // ancestor (see httpClientSpanIdForServerItem).
    expect(event?.parent_span_ids).toEqual([CLIENT_PARENT_A, CLIENT_PARENT_B]);
    expect(event?.page_view_span_id).toBe(context.pageViewSpanId);
    expect(event?.http_client_span_id).toBe(HTTP_CLIENT);
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
  });

  function makeRealApp() {
    return new StackServerApp({
      projectId: PROJECT_ID,
      publishableClientKey: "pck_test",
      secretServerKey: "ssk_test",
      baseUrl: "https://api.example.test",
      tokenStore: "memory",
      noAutomaticPrefetch: true,
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

  it("disables server telemetry for the process after an ANALYTICS_NOT_ENABLED rejection (warn once, no further sends)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests = stubFetch((url) => url.includes("analytics")
      ? new Response(JSON.stringify({ code: "ANALYTICS_NOT_ENABLED" }), { status: 400 })
      : null);
    const app = makeRealApp();

    await expect(app.trackEvent("checkout_completed")).rejects.toThrow(/ANALYTICS_NOT_ENABLED/);
    const analyticsSendCount = requests.filter((request) => request.url.includes("analytics")).length;
    expect(analyticsSendCount).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("disabled"));

    // Sticky: later telemetry rejects locally without another doomed send.
    await expect(app.trackEvent("checkout_completed")).rejects.toThrow(/not enabled/);
    expect(requests.filter((request) => request.url.includes("analytics")).length).toBe(analyticsSendCount);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("bare trackEvent adopts the framework's ambient request (session + propagated ancestry, zero threading)", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);
    expect(instrumentation).not.toBeNull();

    const headerValue = encodeSpanContextHeader({
      projectId: PROJECT_ID,
      sessionReplaySegmentId: "55555555-5555-4555-8555-555555555555",
      pageViewSpanId: "66666666-6666-4666-8666-666666666666",
      customParentSpanIds: [CLIENT_PARENT_A, CLIENT_PARENT_B],
    });
    const ambientRequest = {
      headers: {
        get: (name: string) => (name.toLowerCase() === SPAN_CONTEXT_HEADER ? headerValue : null),
      },
    };
    instrumentation?.setAmbientRequestProvider(async () => ambientRequest);

    await app.trackEvent("checkout_completed", { amount: 42 });

    const batchRequest = requests.find((request) => request.url.includes("analytics"));
    expect(batchRequest).not.toBeUndefined();
    const payload = JSON.parse(batchRequest?.body ?? "{}") as {
      session_replay_segment_id?: string,
      events?: { event_type: string, parent_span_ids?: string[], page_view_span_id?: string }[],
    };
    expect(payload.session_replay_segment_id).toBe("55555555-5555-4555-8555-555555555555");
    expect(payload.events).toHaveLength(1);
    expect(payload.events?.[0]?.event_type).toBe("checkout_completed");
    expect(payload.events?.[0]?.parent_span_ids).toEqual([CLIENT_PARENT_A, CLIENT_PARENT_B]);
    expect(payload.events?.[0]?.page_view_span_id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("bare withSpan adopts the ambient request; a provider returning null degrades to plain telemetry", async () => {
    const requests = stubFetch();
    const app = makeRealApp();
    const instrumentation = getServerAppInstrumentation(app);

    const headerValue = encodeSpanContextHeader({
      projectId: PROJECT_ID,
      sessionReplaySegmentId: "55555555-5555-4555-8555-555555555555",
      customParentSpanIds: [CLIENT_PARENT_A],
    });
    let insideRequestScope = true;
    instrumentation?.setAmbientRequestProvider(async () => insideRequestScope
      ? { headers: { get: (name: string) => (name.toLowerCase() === SPAN_CONTEXT_HEADER ? headerValue : null) } }
      : null);

    await app.withSpan("process-order", async () => {});
    await app.flush();

    const withContext = JSON.parse(requests.find((request) => request.url.includes("analytics"))?.body ?? "{}") as {
      session_replay_segment_id?: string,
      spans?: { span_type: string, parent_span_ids?: string[] }[],
    };
    expect(withContext.session_replay_segment_id).toBe("55555555-5555-4555-8555-555555555555");
    expect(withContext.spans?.some((span) => span.span_type === "process-order" && span.parent_span_ids?.[0] === CLIENT_PARENT_A)).toBe(true);

    // Outside a request scope the provider returns null — telemetry still
    // works, just without request ancestry (and without warning: null is a
    // normal state, not an error).
    requests.length = 0;
    insideRequestScope = false;
    await app.withSpan("background-job", async () => {});
    await app.flush();
    const withoutContext = JSON.parse(requests.find((request) => request.url.includes("analytics"))?.body ?? "{}") as {
      session_replay_segment_id?: string,
      spans?: { span_type: string }[],
    };
    expect(withoutContext.session_replay_segment_id).toBeUndefined();
    expect(withoutContext.spans?.some((span) => span.span_type === "background-job")).toBe(true);
  });
});
