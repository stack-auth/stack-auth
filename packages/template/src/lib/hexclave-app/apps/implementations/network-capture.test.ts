import { isW3cSpanId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginHttpClientSpanCore,
  normalizeNetworkCaptureOptions,
  sanitizeHttpClientUrl,
  shouldCaptureNetworkRequest,
  SLOW_REQUEST_ALWAYS_KEEP_MS,
  type NetworkCaptureConfig,
} from "./network-capture";
import type { SpanUpdateRow } from "./telemetry-core";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeNetworkCaptureOptions", () => {
  it("defaults to capture-everything", () => {
    expect(normalizeNetworkCaptureOptions(undefined)).toMatchInlineSnapshot(`
      {
        "allowOrigins": null,
        "capture": "all",
        "denyOrigins": null,
        "enabled": true,
        "ignoreUrls": [],
        "sampleRate": 1,
      }
    `);
  });

  it("throws when allowOrigins and denyOrigins are both set", () => {
    expect(() => normalizeNetworkCaptureOptions({ allowOrigins: ["https://a.example"], denyOrigins: ["https://b.example"] }))
      .toThrow(/mutually exclusive/);
  });

  it("throws on out-of-range or non-numeric sampleRate", () => {
    expect(() => normalizeNetworkCaptureOptions({ sampleRate: 2 })).toThrow(/between 0 and 1/);
    expect(() => normalizeNetworkCaptureOptions({ sampleRate: -0.1 })).toThrow(/between 0 and 1/);
    expect(() => normalizeNetworkCaptureOptions({ sampleRate: Number.NaN })).toThrow(/between 0 and 1/);
  });
});

describe("sanitizeHttpClientUrl", () => {
  it("keeps only origin + pathname (drops query, hash, and userinfo)", () => {
    expect(sanitizeHttpClientUrl("https://user:pass@api.example.com/v1/orders?token=secret#frag"))
      .toBe("https://api.example.com/v1/orders");
  });

  it("resolves relative urls against the base", () => {
    expect(sanitizeHttpClientUrl("/orders?q=1", "https://app.example.com")).toBe("https://app.example.com/orders");
  });

  it("returns null for non-http(s) and unparseable targets", () => {
    expect(sanitizeHttpClientUrl("data:text/plain,hi")).toBeNull();
    expect(sanitizeHttpClientUrl("ws://api.example.com/socket")).toBeNull();
    expect(sanitizeHttpClientUrl("/relative-without-base")).toBeNull();
    expect(sanitizeHttpClientUrl("http://[")).toBeNull();
  });
});

describe("shouldCaptureNetworkRequest", () => {
  const base = normalizeNetworkCaptureOptions(undefined);

  it("respects enabled: false", () => {
    expect(shouldCaptureNetworkRequest({ ...base, enabled: false }, new URL("https://x.example/a"))).toBe(false);
  });

  it("allowOrigins restricts to exactly those origins", () => {
    const config: NetworkCaptureConfig = { ...base, allowOrigins: ["https://api.example.com"] };
    expect(shouldCaptureNetworkRequest(config, new URL("https://api.example.com/a"))).toBe(true);
    expect(shouldCaptureNetworkRequest(config, new URL("https://other.example.com/a"))).toBe(false);
  });

  it("denyOrigins excludes those origins", () => {
    const config: NetworkCaptureConfig = { ...base, denyOrigins: ["https://blocked.example.com"] };
    expect(shouldCaptureNetworkRequest(config, new URL("https://blocked.example.com/a"))).toBe(false);
    expect(shouldCaptureNetworkRequest(config, new URL("https://fine.example.com/a"))).toBe(true);
  });

  it("ignoreUrls matches substrings of the full url (empty strings never match)", () => {
    const config: NetworkCaptureConfig = { ...base, ignoreUrls: ["/health", ""] };
    expect(shouldCaptureNetworkRequest(config, new URL("https://x.example/api/health?probe=1"))).toBe(false);
    expect(shouldCaptureNetworkRequest(config, new URL("https://x.example/api/orders"))).toBe(true);
  });
});

describe("beginHttpClientSpanCore", () => {
  // Real W3C ids: the row shape is the wire contract, so a test with fake ids
  // could pass against a row ClickHouse would reject.
  const TRACE_ID = "1111111111111111111111111111aaaa";
  const PARENT_SPAN_ID = "1111111111111111";
  const PAGE_VIEW_SPAN_ID = "2222222222222222";

  function collectRows() {
    const rows: SpanUpdateRow[] = [];
    const enqueueRow = (row: SpanUpdateRow) => {
      rows.push(row);
      return Promise.resolve();
    };
    return { rows, enqueueRow };
  }

  const config = normalizeNetworkCaptureOptions(undefined);

  it("guaranteed-keep: writes the open interval immediately and is propagation-eligible", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://api.example.com/orders",
      method: "POST",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: PARENT_SPAN_ID,
      pageViewSpanId: PAGE_VIEW_SPAN_ID,
      enqueueRow,
    });
    expect(handle.propagate).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      span_type: "$http-client",
      ended_at_ms: null,
      trace_id: TRACE_ID,
      parent_span_id: PARENT_SPAN_ID,
      page_view_span_id: PAGE_VIEW_SPAN_ID,
      data: { method: "POST", url: "https://api.example.com/orders", transport: "fetch" },
    });
    // The span mints its OWN id inside its caller's trace; a span that reused
    // its parent's id (or an all-zero one) would collide in ClickHouse.
    expect(isW3cSpanId(rows[0].span_id)).toBe(true);
    expect(rows[0].span_id).not.toBe(PARENT_SPAN_ID);
    expect(isW3cTraceId(rows[0].trace_id)).toBe(true);
    // The handle's advertised identity is exactly what lands on the wire — this
    // is what the outgoing `traceparent` is built from.
    expect(handle.spanContext).toEqual({ traceId: TRACE_ID, spanId: rows[0].span_id });

    handle.end({ status: 200, errored: false, aborted: false, propagated: true });
    const last = rows[rows.length - 1];
    expect(last.ended_at_ms).not.toBeNull();
    expect(last.data).toMatchObject({ status: 200, propagated: 1 });
    expect(last.data.error).toBeUndefined();
  });

  it("a root fetch (no ambient parent) is the trace root: parent_span_id is null", () => {
    const { rows, enqueueRow } = collectRows();
    beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://api.example.com/orders",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    // null (not omitted, not ""): `trace_roots_mv` fires on `parent_span_id IS
    // NULL`, so this is what makes the fetch show up in the trace inbox.
    expect(rows[0].parent_span_id).toBeNull();
    // No page correlation to report, so the key is absent rather than null.
    expect("page_view_span_id" in rows[0]).toBe(false);
  });

  it("passes unsampled capture-all rows to the shared flusher but does not propagate them", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: false,
      sanitizedUrl: "https://api.example.com/orders",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    expect(handle.propagate).toBe(false);
    handle.end({ status: 200, errored: false, aborted: false });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1].data).toMatchObject({ status: 200 });
  });

  it("passes unsampled failures to the shared flusher for trace promotion", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: false,
      sanitizedUrl: "https://api.example.com/orders",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    handle.end({ status: 500, errored: false, aborted: false });
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    expect(last.ended_at_ms).not.toBeNull();
    expect(last.data).toMatchObject({ status: 500, method: "GET", transport: "fetch" });
  });

  it("errors-only keeps network errors and drops successes; is never propagation-eligible", () => {
    const errorsOnly: NetworkCaptureConfig = { ...config, capture: "errors-only" };

    const success = collectRows();
    const successHandle = beginHttpClientSpanCore({
      config: errorsOnly, sampled: true, sanitizedUrl: "https://x.example/a", method: "GET", transport: "xhr",
      traceId: TRACE_ID, parentSpanId: null, pageViewSpanId: null, enqueueRow: success.enqueueRow,
    });
    expect(successHandle.propagate).toBe(false);
    successHandle.end({ status: 204, errored: false, aborted: false });
    expect(success.rows).toHaveLength(0);

    const failure = collectRows();
    const failureHandle = beginHttpClientSpanCore({
      config: errorsOnly, sampled: true, sanitizedUrl: "https://x.example/a", method: "GET", transport: "xhr",
      traceId: TRACE_ID, parentSpanId: null, pageViewSpanId: null, enqueueRow: failure.enqueueRow,
    });
    failureHandle.end({ errored: true, aborted: false });
    const last = failure.rows[failure.rows.length - 1];
    expect(last.data).toMatchObject({ error: 1, transport: "xhr" });
    expect(last.ended_at_ms).not.toBeNull();
  });

  it("keeps a pre-load open row local until a live delivery buffer owns it", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://api.example.com/bootstrap",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
      propagationEligible: false,
    });

    expect(rows).toHaveLength(1);
    expect(handle.propagate).toBe(false);
  });

  it("errors-only still keeps slow requests before the shared flusher", () => {
    let nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config: { ...config, capture: "errors-only" },
      sampled: false,
      sanitizedUrl: "https://x.example/slow",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    nowMs = SLOW_REQUEST_ALWAYS_KEEP_MS;
    handle.end({ status: 200, errored: false, aborted: false });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1].data).toMatchObject({ status: 200 });
  });

  it("fast aborts are NOT in the always-keep class (SPA cancellations are routine)", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config: { ...config, capture: "errors-only" },
      sampled: false,
      sanitizedUrl: "https://x.example/aborted",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    handle.end({ errored: true, aborted: true });
    expect(rows).toHaveLength(0);
  });

  it("records aborts on kept spans and ends idempotently", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://x.example/aborted",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    handle.end({ errored: true, aborted: true });
    const countAfterFirstEnd = rows.length;
    expect(rows[rows.length - 1].data).toMatchObject({ error: 1, aborted: 1 });
    handle.end({ status: 200, errored: false, aborted: false });
    expect(rows).toHaveLength(countAfterFirstEnd);
  });

  it("markInert stops emission (sign-out privacy)", () => {
    const { rows, enqueueRow } = collectRows();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://x.example/a",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow,
    });
    const countAfterOpen = rows.length;
    handle.markInert();
    handle.end({ status: 500, errored: false, aborted: false });
    expect(rows).toHaveLength(countAfterOpen);
  });

  it("fires onEnded exactly once (registry cleanup hook)", () => {
    const onEnded = vi.fn();
    const handle = beginHttpClientSpanCore({
      config,
      sampled: true,
      sanitizedUrl: "https://x.example/a",
      method: "GET",
      transport: "fetch",
      traceId: TRACE_ID,
      parentSpanId: null,
      pageViewSpanId: null,
      enqueueRow: () => Promise.resolve(),
      onEnded,
    });
    handle.end({ status: 200, errored: false, aborted: false });
    handle.end({ status: 200, errored: false, aborted: false });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
