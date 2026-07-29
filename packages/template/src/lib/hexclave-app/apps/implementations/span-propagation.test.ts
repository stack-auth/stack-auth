import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Span } from "./event-tracker";
import {
  SPAN_CONTEXT_HEADER,
  decodeSpanContextHeader,
  encodeSpanContextHeader,
  resolveParentRefsToPath,
  installFetchSpanPropagation,
  shouldPropagateSpanContext,
  trustedDomainsToPropagationOrigins,
  type RequestSpanOutcome,
  type SpanPropagationContext,
} from "./span-propagation";

const SEG = "11111111-1111-4111-8111-111111111111";
const REPLAY = "22222222-2222-4222-8222-222222222222";
const CUSTOM_A = "33333333-3333-4333-8333-333333333333";
const CUSTOM_B = "44444444-4444-4444-8444-444444444444";

describe("span propagation header codec", () => {
  it("uses the x-hexclave-span-context header name", () => {
    expect(SPAN_CONTEXT_HEADER).toBe("x-hexclave-span-context");
  });

  it("round-trips a full context and prefixes the version", () => {
    const context: SpanPropagationContext = {
      projectId: "proj-1",
      sessionReplayId: REPLAY,
      sessionReplaySegmentId: SEG,
      customParentSpanIds: [CUSTOM_A, CUSTOM_B],
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
    const header = encodeSpanContextHeader({ projectId: "proj-1", customParentSpanIds: [] });
    expect(decodeSpanContextHeader(header)).toEqual({ projectId: "proj-1" });
  });

  it("caps the custom parent chain at 10, keeping the NEAREST ancestors (list tail)", () => {
    // Mirrors resolveParentIds' overflow rule: on a root-first list, the nearest
    // ancestors are at the end, so the cap keeps the tail.
    const many = Array.from({ length: 15 }, (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`);
    const decoded = decodeSpanContextHeader(encodeSpanContextHeader({ projectId: "p", customParentSpanIds: many }));
    expect(decoded?.customParentSpanIds).toHaveLength(10);
    expect(decoded?.customParentSpanIds).toEqual(many.slice(-10));
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
      customParentSpanIds: [CUSTOM_A, "nope", 42],
    })).toString("base64url")}`;
    expect(decodeSpanContextHeader(badIds)).toEqual({
      projectId: "p",
      sessionReplayId: REPLAY,
      customParentSpanIds: [CUSTOM_A],
    });
  });

  it("rejects a JSON array (not an object) payload", () => {
    const arr = `v1.${Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url")}`;
    expect(decodeSpanContextHeader(arr)).toBeNull();
  });
});

describe("resolveParentRefsToPath", () => {
  it("uses the longest compatible frozen chain, root-first", () => {
    expect(resolveParentRefsToPath([
      { spanId: "b", parentSpanIds: ["a"] },
      { spanId: "c", parentSpanIds: ["a", "b"] },
    ])).toEqual(["a", "b", "c"]);
  });

  it("stitches compatible overlapping paths after root truncation", () => {
    expect(resolveParentRefsToPath([
      { spanId: "c", parentSpanIds: ["a", "b"] },
      { spanId: "d", parentSpanIds: ["b", "c"] },
    ])).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects sibling refs instead of flattening them into a false ancestry path", () => {
    expect(() => resolveParentRefsToPath([
      { spanId: "b", parentSpanIds: ["a"] },
      { spanId: "c", parentSpanIds: ["a"] },
    ])).toThrow(/one ancestry path/);
  });

  it("appends raw ids as explicitly declared next parents", () => {
    const live = { ref: () => ({ spanId: "s2", parentSpanIds: ["g", "s1"] }) } as unknown as Span;
    expect(resolveParentRefsToPath(
      [{ spanId: "s1", parentSpanIds: ["g"] }],
      [live, "raw"],
    )).toEqual(["g", "s1", "s2", "raw"]);
  });

  it("returns [] for no refs and no extras", () => {
    expect(resolveParentRefsToPath([])).toEqual([]);
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
    const explicit = encodeSpanContextHeader({ projectId: "p", customParentSpanIds: [CUSTOM_A] });
    await (globalThis as { fetch: typeof fetch }).fetch("/x", { headers: { [SPAN_CONTEXT_HEADER]: explicit } });
    // Passed through untouched: the wrapper must not clobber the caller's precise intent.
    expect(new Headers(calls[0].init?.headers).get(SPAN_CONTEXT_HEADER)).toBe(explicit);
  });

  it("never overwrites an explicitly-set span-context header (Request headers)", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const explicit = encodeSpanContextHeader({ projectId: "p", customParentSpanIds: [CUSTOM_B] });
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
      getContext: () => ({ projectId: "second", customParentSpanIds: [CUSTOM_A] }),
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
      getContext: () => ({ projectId: "second", customParentSpanIds: [CUSTOM_A] }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => ["https://api.example.com"],
    });

    await (globalThis as { fetch: typeof fetch }).fetch("https://api.example.com/x");

    expect(decodeSpanContextHeader(sentHeader())).toEqual({
      projectId: "second",
      customParentSpanIds: [CUSTOM_A],
    });
    second?.();
  });
});

describe("installFetchSpanPropagation with beginRequestSpan ($http-client bridge)", () => {
  const SELF = "https://app.example.com";
  const SPAN_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const EXPECTED_TRACEPARENT = "00-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa-8aaaaaaaaaaaaaaa-01";

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
    const begin = vi.fn((_info: { url: string, method: string, transport: string }) => {
      if (opts?.span === null) return null;
      return { spanUuid: SPAN_UUID, propagate: opts?.propagate ?? true, end };
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

  it("opens a span for every http(s) request — even cross-origin, where no header may ride", async () => {
    const { begin, end } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("https://third-party.example/data", { method: "POST" });
    expect(begin).toHaveBeenCalledWith({ url: "https://third-party.example/data", method: "POST", transport: "fetch" });
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get("traceparent")).toBeNull();
    // Ended on response headers, with the span never marked propagated.
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
  });

  it("skips span creation for non-http(s) targets", async () => {
    const { begin } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("data:text/plain,hi");
    expect(begin).not.toHaveBeenCalled();
  });

  it("attaches httpClientSpanId + traceparent for a propagatable span on an in-policy request", async () => {
    const { end } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
      httpClientSpanId: SPAN_UUID,
    });
    expect(headers.get("traceparent")).toBe(EXPECTED_TRACEPARENT);
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: true });
  });

  it("omits httpClientSpanId and traceparent for a maybe-kept span (propagate: false) — bridge coherence", async () => {
    const { end } = installWithSpan({ propagate: false });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    expect(headers.get("traceparent")).toBeNull();
    await Promise.resolve();
    expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: false });
  });

  it("still attaches the plain context header when no span was created (sampled out / disabled)", async () => {
    installWithSpan({ span: null });
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    const headers = sentHeaders();
    expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    expect(headers.get("traceparent")).toBeNull();
  });

  it("never overwrites a caller-set traceparent (caller intent wins; span-context still rides)", async () => {
    await (async () => {
      const { end } = installWithSpan();
      await (globalThis as { fetch: typeof fetch }).fetch("/api/x", { headers: { traceparent: "00-11111111111111111111111111111111-1111111111111111-01" } });
      const headers = sentHeaders();
      expect(headers.get("traceparent")).toBe("00-11111111111111111111111111111111-1111111111111111-01");
      expect(decodeSpanContextHeader(headers.get(SPAN_CONTEXT_HEADER))?.httpClientSpanId).toBe(SPAN_UUID);
      await Promise.resolve();
      // The header carrying the uuid was attached, so the span counts as propagated.
      expect(end).toHaveBeenCalledWith({ status: 201, errored: false, aborted: false, propagated: true });
    })();
  });

  it("opens the span but attaches nothing in no-cors mode", async () => {
    const { begin } = installWithSpan();
    await (globalThis as { fetch: typeof fetch }).fetch("/api/x", { mode: "no-cors" });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get("traceparent")).toBeNull();
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
      getContext: () => ({ projectId: "second", customParentSpanIds: [CUSTOM_A] }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
      beginRequestSpan: () => ({ spanUuid: CUSTOM_B, end: secondEnd }),
    });

    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");
    // Two same-origin providers with different contexts: no header at all.
    expect(sentHeaders().get(SPAN_CONTEXT_HEADER)).toBeNull();
    expect(sentHeaders().get("traceparent")).toBeNull();
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
