import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPAN_CONTEXT_HEADER,
  TRACEPARENT_HEADER,
  decodeSpanContextHeader,
  encodeSpanContextHeader,
  installFetchSpanPropagation,
  shouldPropagateSpanContext,
  trustedDomainsToPropagationOrigins,
  type RequestSpanInfo,
  type RequestSpanOutcome,
  type SpanPropagationContext,
} from "./span-propagation";
import type { SpanContext } from "./telemetry-core";

const SEG = "11111111-1111-4111-8111-111111111111";
const REPLAY = "22222222-2222-4222-8222-222222222222";
const PAGE_VIEW_SPAN_ID = "3333333333333333";

describe("span propagation header codec", () => {
  it("uses the x-hexclave-span-context header name", () => {
    expect(SPAN_CONTEXT_HEADER).toBe("x-hexclave-span-context");
  });

  it("round-trips a full context and prefixes the version", () => {
    const context: SpanPropagationContext = {
      projectId: "proj-1",
      sessionReplayId: REPLAY,
      sessionReplaySegmentId: SEG,
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
    };
    const header = encodeSpanContextHeader(context);
    expect(header.startsWith("v1.")).toBe(true);
    expect(decodeSpanContextHeader(header)).toEqual(context);
  });

  it("round-trips a minimal context (projectId + segment only)", () => {
    const context: SpanPropagationContext = { projectId: "proj-1", sessionReplaySegmentId: SEG };
    expect(decodeSpanContextHeader(encodeSpanContextHeader(context))).toEqual(context);
  });

  it("omits empty/absent optional fields from the wire", () => {
    const header = encodeSpanContextHeader({ projectId: "proj-1" });
    expect(decodeSpanContextHeader(header)).toEqual({ projectId: "proj-1" });
  });

  it("carries no hierarchy at all — ancestry rides `traceparent` instead", () => {
    // The header keeps its name but lost its parenting role: an old sender's
    // `customParentSpanIds`/`httpClientSpanId` are now simply unknown fields, and
    // decoding must silently drop them rather than resurrect a second hierarchy
    // carrier alongside `traceparent`.
    const legacy = `v1.${Buffer.from(JSON.stringify({
      projectId: "p",
      httpClientSpanId: "77777777-7777-4777-8777-777777777777",
      customParentSpanIds: ["55555555-5555-4555-8555-555555555555"],
    })).toString("base64url")}`;
    expect(decodeSpanContextHeader(legacy)).toEqual({ projectId: "p" });
  });

  it("returns null for missing / empty / non-string headers", () => {
    expect(decodeSpanContextHeader(null)).toBeNull();
    expect(decodeSpanContextHeader(undefined)).toBeNull();
    expect(decodeSpanContextHeader("")).toBeNull();
    expect(decodeSpanContextHeader(123 as unknown as string)).toBeNull();
  });

  it("ignores unknown versions (forward compatible) and malformed values", () => {
    const v1 = encodeSpanContextHeader({ projectId: "p", sessionReplaySegmentId: SEG });
    const body = v1.slice(v1.indexOf(".") + 1);
    expect(decodeSpanContextHeader(`v2.${body}`)).toBeNull();
    expect(decodeSpanContextHeader("no-dot-here")).toBeNull();
    expect(decodeSpanContextHeader("v1.not-valid-base64!!")).toBeNull();
    expect(decodeSpanContextHeader(`v1.${Buffer.from("not json").toString("base64url")}`)).toBeNull();
  });

  it("rejects an oversized header without decoding it", () => {
    expect(decodeSpanContextHeader(`v1.${"A".repeat(5000)}`)).toBeNull();
  });

  it("requires a projectId, and drops (not fails on) malformed ids", () => {
    const noProject = `v1.${Buffer.from(JSON.stringify({ sessionReplaySegmentId: SEG })).toString("base64url")}`;
    expect(decodeSpanContextHeader(noProject)).toBeNull();

    const badIds = `v1.${Buffer.from(JSON.stringify({
      projectId: "p",
      sessionReplaySegmentId: "not-a-uuid",
      sessionReplayId: REPLAY,
      // A database uuid where a W3C span id belongs: dropped, not fatal.
      pageViewSpanId: "33333333-3333-4333-8333-333333333333",
    })).toString("base64url")}`;
    expect(decodeSpanContextHeader(badIds)).toEqual({
      projectId: "p",
      sessionReplayId: REPLAY,
    });
  });

  it("rejects a JSON array (not an object) payload", () => {
    const arr = `v1.${Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url")}`;
    expect(decodeSpanContextHeader(arr)).toBeNull();
  });
});

describe("shouldPropagateSpanContext (same-origin policy)", () => {
  const self = "https://app.example.com";

  it("propagates to the same origin", () => {
    expect(shouldPropagateSpanContext({ targetUrl: "https://app.example.com/api/x", selfOrigin: self })).toBe(true);
  });

  it("propagates to a relative url (resolves against self)", () => {
    expect(shouldPropagateSpanContext({ targetUrl: "/api/checkout", selfOrigin: self })).toBe(true);
  });

  it("does NOT propagate cross-origin by default", () => {
    expect(shouldPropagateSpanContext({ targetUrl: "https://api.stripe.com/v1/x", selfOrigin: self })).toBe(false);
    expect(shouldPropagateSpanContext({ targetUrl: "https://api.example.com/x", selfOrigin: self })).toBe(false);
  });

  it("propagates cross-origin only when the exact origin is allowlisted", () => {
    expect(shouldPropagateSpanContext({
      targetUrl: "https://api.example.com/x",
      selfOrigin: self,
      allowedOrigins: ["https://api.example.com"],
    })).toBe(true);
  });

  it("excludes non-http(s) and unparseable targets", () => {
    expect(shouldPropagateSpanContext({ targetUrl: "mailto:a@b.com", selfOrigin: self })).toBe(false);
    expect(shouldPropagateSpanContext({ targetUrl: "data:text/plain,hi", selfOrigin: self })).toBe(false);
    // Malformed absolute url (unterminated IPv6 host) throws even with a base.
    expect(shouldPropagateSpanContext({ targetUrl: "http://[", selfOrigin: self })).toBe(false);
  });

  it("cannot resolve a relative url without a self origin, so excludes it", () => {
    expect(shouldPropagateSpanContext({ targetUrl: "/api/x", selfOrigin: null })).toBe(false);
  });

  it("admits localhost/loopback targets (any port) only with allowLocalhost", () => {
    // Split-port local dev: frontend on :3000, api on :3001.
    expect(shouldPropagateSpanContext({ targetUrl: "http://localhost:3001/api/x", selfOrigin: "http://localhost:3000", allowLocalhost: true })).toBe(true);
    expect(shouldPropagateSpanContext({ targetUrl: "http://127.0.0.1:8080/x", selfOrigin: self, allowLocalhost: true })).toBe(true);
    expect(shouldPropagateSpanContext({ targetUrl: "http://api.localhost/x", selfOrigin: self, allowLocalhost: true })).toBe(true);
    // Off by default and never a bypass for non-loopback targets.
    expect(shouldPropagateSpanContext({ targetUrl: "http://localhost:3001/api/x", selfOrigin: "http://localhost:3000" })).toBe(false);
    expect(shouldPropagateSpanContext({ targetUrl: "https://api.stripe.com/v1/x", selfOrigin: self, allowLocalhost: true })).toBe(false);
  });
});

describe("trustedDomainsToPropagationOrigins", () => {
  it("derives exact origins from non-wildcard trusted domains and dedupes", () => {
    expect(trustedDomainsToPropagationOrigins([
      "https://app.example.com",
      "https://app.example.com/handler",
      "https://api.example.com:8443",
      "http://staging.example.com",
    ])).toEqual([
      "https://app.example.com",
      "https://api.example.com:8443",
      "http://staging.example.com",
    ]);
  });

  it("skips wildcard patterns (propagation stays exact-match, fail-closed)", () => {
    expect(trustedDomainsToPropagationOrigins(["https://*.example.com", "https://**.example.com"])).toEqual([]);
  });

  it("skips invalid and non-http(s) entries instead of failing the whole list", () => {
    expect(trustedDomainsToPropagationOrigins([
      "not a url",
      "hexclave-mobile-oauth-url://callback",
      "https://good.example.com",
    ])).toEqual(["https://good.example.com"]);
  });
});

describe("installFetchSpanPropagation", () => {
  const SELF = "https://app.example.com";
  let calls: { input: unknown, init: RequestInit | undefined }[];
  let originalFetch: typeof fetch;
  let uninstall: (() => void) | null | undefined;

  beforeEach(() => {
    calls = [];
    originalFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve({ ok: true } as Response);
    }) as typeof fetch;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  function install(context: SpanPropagationContext | null, allowedOrigins: string[] = []) {
    uninstall = installFetchSpanPropagation({
      getContext: () => context,
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => allowedOrigins,
    });
  }

  function sentHeader(index = 0): string | null {
    const init = calls[index]?.init;
    if (!init?.headers) return null;
    return new Headers(init.headers).get(SPAN_CONTEXT_HEADER);
  }

  it("attaches the header on a same-origin string url", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    expect(decodeSpanContextHeader(sentHeader())).toEqual({ projectId: "p", sessionReplaySegmentId: SEG });
  });

  it("does not attach cross-origin by default", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    await (globalThis as { fetch: typeof fetch }).fetch("https://evil.example/x");
    expect(sentHeader()).toBeNull();
  });

  it("attaches to an allowlisted cross origin", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG }, ["https://api.example.com"]);
    await (globalThis as { fetch: typeof fetch }).fetch("https://api.example.com/x");
    expect(sentHeader()).not.toBeNull();
  });

  it("preserves a Request's own headers and adds ours", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const req = new Request("https://app.example.com/x", { headers: { "x-custom": "1" } });
    await (globalThis as { fetch: typeof fetch }).fetch(req);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-custom")).toBe("1");
    expect(headers.get(SPAN_CONTEXT_HEADER)).not.toBeNull();
  });

  it("preserves init.headers and adds ours", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    await (globalThis as { fetch: typeof fetch }).fetch("/x", { headers: { "x-custom": "2" } });
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-custom")).toBe("2");
    expect(headers.get(SPAN_CONTEXT_HEADER)).not.toBeNull();
  });

  it("skips no-cors requests (custom headers are stripped there anyway)", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    await (globalThis as { fetch: typeof fetch }).fetch("/x", { mode: "no-cors" });
    expect(sentHeader()).toBeNull();
  });

  it("attaches nothing when there is no context to propagate", async () => {
    install(null);
    await (globalThis as { fetch: typeof fetch }).fetch("/x");
    expect(sentHeader()).toBeNull();
  });

  it("never overwrites an explicitly-set span-context header (init.headers)", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const explicit = encodeSpanContextHeader({ projectId: "p", pageViewSpanId: PAGE_VIEW_SPAN_ID });
    await (globalThis as { fetch: typeof fetch }).fetch("/x", { headers: { [SPAN_CONTEXT_HEADER]: explicit } });
    // Passed through untouched: the wrapper must not clobber the caller's precise intent.
    expect(new Headers(calls[0].init?.headers).get(SPAN_CONTEXT_HEADER)).toBe(explicit);
  });

  it("never overwrites an explicitly-set span-context header (Request headers)", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const explicit = encodeSpanContextHeader({ projectId: "p", sessionReplayId: REPLAY });
    const req = new Request("https://app.example.com/x", { headers: { [SPAN_CONTEXT_HEADER]: explicit } });
    await (globalThis as { fetch: typeof fetch }).fetch(req);
    // No init constructed — the Request (with its own header) passes through as-is.
    expect(calls[0].init?.headers).toBeUndefined();
    expect((calls[0].input as Request).headers.get(SPAN_CONTEXT_HEADER)).toBe(explicit);
  });

  it("shares one wrapper across providers and uninstalls after the last provider", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const second = installFetchSpanPropagation({ getContext: () => null, getSelfOrigin: () => SELF, getAllowedOrigins: () => [] });
    expect(second).toBeTypeOf("function");
    uninstall?.();
    uninstall = undefined;
    expect((globalThis as { fetch: typeof fetch }).fetch).not.toBe(originalFetch);
    second?.();
    expect((globalThis as { fetch: typeof fetch }).fetch).toBe(originalFetch);
  });

  it("fails closed when two eligible apps provide different project contexts", async () => {
    install({ projectId: "first", sessionReplaySegmentId: SEG });
    const second = installFetchSpanPropagation({
      getContext: () => ({ projectId: "second", pageViewSpanId: PAGE_VIEW_SPAN_ID }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
    });
    expect(second).toBeTypeOf("function");

    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    expect(sentHeader()).toBeNull();
    second?.();
  });

  it("uses the sole provider whose origin policy permits the target", async () => {
    install({ projectId: "first", sessionReplaySegmentId: SEG });
    const second = installFetchSpanPropagation({
      getContext: () => ({ projectId: "second", pageViewSpanId: PAGE_VIEW_SPAN_ID }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => ["https://api.example.com"],
    });

    await (globalThis as { fetch: typeof fetch }).fetch("https://api.example.com/x");

    expect(decodeSpanContextHeader(sentHeader())).toEqual({
      projectId: "second",
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
    });
    second?.();
  });
});

describe("installFetchSpanPropagation with beginRequestSpan ($http-client bridge)", () => {
  const SELF = "https://app.example.com";
  const SPAN: SpanContext = { traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spanId: "bbbbbbbbbbbbbbbb" };
  const SAMPLED_TRACEPARENT = `00-${SPAN.traceId}-${SPAN.spanId}-01`;

  let calls: { input: unknown, init: RequestInit | undefined }[];
  let originalFetch: typeof fetch;
  let uninstall: (() => void) | null | undefined;
  let nextResponse: () => Promise<Response>;

  beforeEach(() => {
    calls = [];
    nextResponse = () => Promise.resolve({ status: 201 } as Response);
    originalFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return nextResponse();
    }) as typeof fetch;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  function sentHeaders(index = 0): Headers {
    return new Headers(calls[index]?.init?.headers);
  }

  function installWithSpan(opts?: {
    propagate?: boolean,
    span?: null,
    context?: SpanPropagationContext | null,
  }) {
    const begin = vi.fn((_info: RequestSpanInfo) => {
      if (opts?.span === null) return null;
      return { spanContext: SPAN, propagate: opts?.propagate ?? true, end };
    });
    const end = vi.fn((_outcome: RequestSpanOutcome) => {});
    uninstall = installFetchSpanPropagation({
      getContext: () => (opts?.context !== undefined ? opts.context : { projectId: "p", sessionReplaySegmentId: SEG }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
      beginRequestSpan: begin,
    });
    return { begin, end };
  }

  // Regression: the receiver can only inherit the parent named by `traceparent`
  // once it knows the caller is in the same project — otherwise it must root its
  // own span or the row becomes an invisible orphan. So the project claim rides
  // WITH the hierarchy even in the pre-page-view window (which is exactly when a
  // browser makes its auth requests).
  it("states the project alongside traceparent even with no correlation ids yet", async () => {
    installWithSpan({ context: { projectId: "p" } });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    expect(sentHeaders().get(TRACEPARENT_HEADER)).toBe(SAMPLED_TRACEPARENT);
    expect(decodeSpanContextHeader(sentHeaders().get(SPAN_CONTEXT_HEADER))).toEqual({ projectId: "p" });
  });

  it("says nothing at all when there is neither a span nor a correlation id", async () => {
    installWithSpan({ span: null, context: null });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    expect(sentHeaders().get(TRACEPARENT_HEADER)).toBeNull();
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
  });

  it("opens a span for every http(s) request — even cross-origin, where no header may ride", async () => {
    const { begin, end } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("https://third-party.example/data", { method: "POST" });
    expect(begin).toHaveBeenCalledWith({ url: "https://third-party.example/data", method: "POST", transport: "fetch" });
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get(TRACEPARENT_HEADER)).toBeNull();
    // Ended on response headers, with the span never marked propagated.
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
  });

  it("skips span creation for non-http(s) targets", async () => {
    const { begin } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("data:text/plain,hi");
    expect(begin).not.toHaveBeenCalled();
  });

  it("attaches traceparent (flags 01) + the correlation header on an in-policy request", async () => {
    const { end } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    // The correlation header carries NO hierarchy any more — the whole
    // parent/child relationship is the `traceparent` below.
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    expect(headers.get(TRACEPARENT_HEADER)).toBe(SAMPLED_TRACEPARENT);
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: true });
  });

  it("does not advertise a maybe-kept span as a remote parent", async () => {
    const { end } = installWithSpan({ propagate: false });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    expect(headers.get(TRACEPARENT_HEADER)).toBeNull();
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
  });

  it("still attaches the plain context header when no span was created (capture disabled / filtered)", async () => {
    installWithSpan({ span: null });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    // No span means no hierarchy to state: inventing a traceparent here would
    // name a span that was never written.
    expect(headers.get(TRACEPARENT_HEADER)).toBeNull();
  });

  it("never overwrites a caller-set traceparent (caller intent wins; the correlation header still rides)", async () => {
    const callerTraceparent = "00-11111111111111111111111111111111-1111111111111111-01";
    const { end } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x", { headers: { [TRACEPARENT_HEADER]: callerTraceparent } });
    const headers = sentHeaders();
    expect(headers.get(TRACEPARENT_HEADER)).toBe(callerTraceparent);
    // Per-header precedence, not all-or-nothing: our correlation header is still
    // attached even though the hierarchy header was the caller's.
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    await Promise.resolve();
    // `propagated: false` — the load-bearing half of this test. It reports whether
    // the RECEIVER can join THIS span's trace, so it keys on our traceparent riding,
    // not on "some header of ours was attached". Here the caller's traceparent won,
    // so the backend joins the caller's trace and this span has no cross-tier link;
    // claiming otherwise would put a `propagated: 1` on the row that no backend span
    // actually corroborates.
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
  });

  it("opens the span but attaches nothing in no-cors mode", async () => {
    const { begin } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x", { mode: "no-cors" });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get(TRACEPARENT_HEADER)).toBeNull();
  });

  it("ends with errored on rejection, and aborted for AbortError rejections", async () => {
    const { end } = installWithSpan();
    nextResponse = () => Promise.reject(new Error("connection reset"));
    await expect((globalThis as { fetch: typeof fetch }).fetch("/api/x")).rejects.toThrow("connection reset");
    await Promise.resolve();
    expect(end).toHaveBeenLastCalledWith({ errored: true, aborted: false, propagated: true });

    nextResponse = () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect((globalThis as { fetch: typeof fetch }).fetch("/api/x")).rejects.toThrow("aborted");
    await Promise.resolve();
    expect(end).toHaveBeenLastCalledWith({ errored: true, aborted: true, propagated: true });
  });

  it("each provider opens its own span, while header attachment stays fail-closed", async () => {
    const first = installWithSpan();
    const secondEnd = vi.fn();
    const secondUninstall = installFetchSpanPropagation({
      getContext: () => ({ projectId: "second", pageViewSpanId: PAGE_VIEW_SPAN_ID }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
      beginRequestSpan: () => ({ spanContext: { traceId: "cccccccccccccccccccccccccccccccc", spanId: "dddddddddddddddd" }, end: secondEnd }),
    });

    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    // Two same-origin providers with different contexts: no header at all. Under
    // W3C this matters more than it used to — joining the request to an
    // arbitrary one of two candidate TRACES would be silently wrong, not just
    // mislabeled.
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get(TRACEPARENT_HEADER)).toBeNull();
    expect(first.begin).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(first.end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
    expect(secondEnd).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
    secondUninstall?.();
  });

  it("a throwing beginRequestSpan never breaks the request (and other providers still work)", async () => {
    uninstall = installFetchSpanPropagation({
      getContext: () => ({ projectId: "p", sessionReplaySegmentId: SEG }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
      beginRequestSpan: () => {
        throw new Error("broken provider");
      },
    });
    const response = await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    expect(response.status).toBe(201);
  });
});
