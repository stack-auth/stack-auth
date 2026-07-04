import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Span } from "./event-tracker";
import {
  SPAN_CONTEXT_HEADER,
  decodeSpanContextHeader,
  encodeSpanContextHeader,
  flattenParentRefsToIds,
  installFetchSpanPropagation,
  shouldPropagateSpanContext,
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

describe("flattenParentRefsToIds", () => {
  it("contributes each ref's full frozen chain, root-first", () => {
    // A global span (a→b) plus a nested withSpan frame (a→c): the ancestry a
    // locally-tracked event would get, so the propagated backend span matches.
    expect(flattenParentRefsToIds([
      { spanId: "b", parentSpanIds: ["a"] },
      { spanId: "c", parentSpanIds: ["a"] },
    ])).toEqual(["a", "b", "c"]);
  });

  it("dedupes across overlapping chains preserving first-seen order", () => {
    expect(flattenParentRefsToIds([
      { spanId: "c", parentSpanIds: ["a", "b"] },
      { spanId: "d", parentSpanIds: ["b"] },
    ])).toEqual(["a", "b", "c", "d"]);
  });

  it("appends explicit extras: raw string contributes only itself, refs/spans their chains", () => {
    const live = { ref: () => ({ spanId: "s2", parentSpanIds: ["s1"] }) } as unknown as Span;
    expect(flattenParentRefsToIds(
      [{ spanId: "g", parentSpanIds: [] }],
      ["raw", { spanId: "r2", parentSpanIds: ["r1"] }, live],
    )).toEqual(["g", "raw", "r1", "r2", "s1", "s2"]);
  });

  it("returns [] for no refs and no extras", () => {
    expect(flattenParentRefsToIds([])).toEqual([]);
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

  it("is idempotent and uninstalls cleanly", async () => {
    install({ projectId: "p", sessionReplaySegmentId: SEG });
    const second = installFetchSpanPropagation({ getContext: () => null, getSelfOrigin: () => SELF, getAllowedOrigins: () => [] });
    expect(second).toBeNull();
    uninstall?.();
    uninstall = undefined;
    expect((globalThis as { fetch: typeof fetch }).fetch).toBe(originalFetch);
  });

  it("updates the shared provider when another app installs after the wrapper is already active", async () => {
    install({ projectId: "first", sessionReplaySegmentId: SEG });
    const second = installFetchSpanPropagation({
      getContext: () => ({ projectId: "second", customParentSpanIds: [CUSTOM_A] }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
    });
    expect(second).toBeNull();

    await (globalThis as { fetch: typeof fetch }).fetch("/api/x");

    expect(decodeSpanContextHeader(sentHeader())).toEqual({
      projectId: "second",
      customParentSpanIds: [CUSTOM_A],
    });
  });
});
