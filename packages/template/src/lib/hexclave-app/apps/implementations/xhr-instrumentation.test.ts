import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSpanContextHeader, SPAN_CONTEXT_HEADER, type RequestSpanOutcome, type SpanPropagationContext } from "./span-propagation";
import { installXhrSpanPropagation } from "./xhr-instrumentation";

const SELF = "https://app.example.com";
const SEG = "11111111-1111-4111-8111-111111111111";
const SPAN_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPECTED_TRACEPARENT = "00-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa-8aaaaaaaaaaaaaaa-01";

/** Minimal XHR stand-in: real prototype methods (so the patch has something to
 * wrap), instance-recorded calls, and manual event dispatch. */
class StubXhr {
  status = 0;
  opened: { method: string, url: string }[] = [];
  headersSet: [string, string][] = [];
  sentBodies: unknown[] = [];
  listeners = new Map<string, ((event: unknown) => void)[]>();

  open(method: string, url: string | URL): void {
    this.opened.push({ method, url: String(url) });
  }

  setRequestHeader(name: string, value: string): void {
    this.headersSet.push([name, value]);
  }

  send(body?: unknown): void {
    this.sentBodies.push(body ?? null);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type });
    }
  }

  headerValue(name: string): string | null {
    const entry = this.headersSet.find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
  }
}

describe("installXhrSpanPropagation", () => {
  let uninstall: (() => void) | null | undefined;
  let ends: RequestSpanOutcome[];
  let begins: { url: string, method: string, transport: string }[];

  beforeEach(() => {
    ends = [];
    begins = [];
    vi.stubGlobal("XMLHttpRequest", StubXhr);
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.unstubAllGlobals();
  });

  function install(opts?: { propagate?: boolean, span?: null, context?: SpanPropagationContext | null }) {
    uninstall = installXhrSpanPropagation({
      getContext: () => (opts?.context !== undefined ? opts.context : { projectId: "p", sessionReplaySegmentId: SEG }),
      getSelfOrigin: () => SELF,
      getAllowedOrigins: () => [],
      beginRequestSpan: (info) => {
        begins.push(info);
        if (opts?.span === null) return null;
        return {
          spanUuid: SPAN_UUID,
          propagate: opts?.propagate ?? true,
          end: (outcome) => ends.push(outcome),
        };
      },
    });
    expect(uninstall).toBeTypeOf("function");
  }

  function request(url: string, opts?: { method?: string, beforeSend?: (xhr: StubXhr) => void }): StubXhr {
    const xhr = new StubXhr();
    xhr.open(opts?.method ?? "GET", url);
    opts?.beforeSend?.(xhr);
    xhr.send();
    return xhr;
  }

  it("attaches span-context + traceparent same-origin, opens a transport:xhr span, ends on loadend", () => {
    install();
    const xhr = request("/api/orders", { method: "post" });
    // Original open/send still ran.
    expect(xhr.opened).toEqual([{ method: "post", url: "/api/orders" }]);
    expect(xhr.sentBodies).toHaveLength(1);
    expect(decodeSpanContextHeader(xhr.headerValue(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
      httpClientSpanId: SPAN_UUID,
    });
    expect(xhr.headerValue("traceparent")).toBe(EXPECTED_TRACEPARENT);

    xhr.status = 200;
    xhr.fire("loadend");
    expect(begins).toEqual([{ url: "https://app.example.com/api/orders", method: "POST", transport: "xhr" }]);
    expect(ends).toEqual([{ status: 200, errored: false, aborted: false, propagated: true }]);
  });

  it("opens a span for cross-origin requests but attaches no headers there", () => {
    install();
    const xhr = request("https://third-party.example/data");
    expect(xhr.headersSet).toHaveLength(0);
    xhr.status = 404;
    xhr.fire("loadend");
    expect(begins).toEqual([{ url: "https://third-party.example/data", method: "GET", transport: "xhr" }]);
    expect(ends).toEqual([{ status: 404, errored: false, aborted: false, propagated: false }]);
  });

  it("never overwrites a caller-set span-context header (span still opens, unpropagated)", () => {
    install();
    const xhr = request("/api/x", { beforeSend: (pending) => pending.setRequestHeader(SPAN_CONTEXT_HEADER, "caller-value") });
    expect(xhr.headersSet).toEqual([[SPAN_CONTEXT_HEADER, "caller-value"]]);
    xhr.status = 200;
    xhr.fire("loadend");
    expect(ends[0]).toMatchObject({ propagated: false });
  });

  it("never overwrites a caller-set traceparent (span-context still rides)", () => {
    install();
    const xhr = request("/api/x", { beforeSend: (pending) => pending.setRequestHeader("Traceparent", "caller-tp") });
    expect(xhr.headerValue("traceparent")).toBe("caller-tp");
    expect(decodeSpanContextHeader(xhr.headerValue(SPAN_CONTEXT_HEADER))?.httpClientSpanId).toBe(SPAN_UUID);
  });

  it("omits httpClientSpanId + traceparent for maybe-kept spans (propagate: false)", () => {
    install({ propagate: false });
    const xhr = request("/api/x");
    expect(decodeSpanContextHeader(xhr.headerValue(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    expect(xhr.headerValue("traceparent")).toBeNull();
  });

  it("attaches the plain context header when no span was created", () => {
    install({ span: null });
    const xhr = request("/api/x");
    expect(decodeSpanContextHeader(xhr.headerValue(SPAN_CONTEXT_HEADER))).toEqual({
      projectId: "p",
      sessionReplaySegmentId: SEG,
    });
    expect(xhr.headerValue("traceparent")).toBeNull();
  });

  it("status 0 on loadend means no response headers: errored, aborted when abort fired", () => {
    install();
    const failed = request("/api/x");
    failed.fire("loadend");
    expect(ends[0]).toMatchObject({ errored: true, aborted: false });
    expect(ends[0].status).toBeUndefined();

    const aborted = request("/api/x");
    aborted.fire("abort");
    aborted.fire("loadend");
    expect(ends[1]).toMatchObject({ errored: true, aborted: true });
  });

  it("uninstalling the last provider restores the prototype methods", () => {
    const originalOpen = StubXhr.prototype.open;
    const originalSend = StubXhr.prototype.send;
    const originalSetRequestHeader = StubXhr.prototype.setRequestHeader;
    install();
    expect(StubXhr.prototype.open).not.toBe(originalOpen);
    uninstall?.();
    uninstall = undefined;
    expect(StubXhr.prototype.open).toBe(originalOpen);
    expect(StubXhr.prototype.send).toBe(originalSend);
    expect(StubXhr.prototype.setRequestHeader).toBe(originalSetRequestHeader);
  });

  it("does not overwrite prototype patches installed after Hexclave", () => {
    const originalOpen = StubXhr.prototype.open;
    const originalSend = StubXhr.prototype.send;
    const originalSetRequestHeader = StubXhr.prototype.setRequestHeader;
    install();

    const hexclaveOpen = StubXhr.prototype.open;
    const hexclaveSend = StubXhr.prototype.send;
    const hexclaveSetRequestHeader = StubXhr.prototype.setRequestHeader;
    const laterOpen: StubXhr["open"] = function (this: StubXhr, ...args) {
      return hexclaveOpen.apply(this, args);
    };
    const laterSend: StubXhr["send"] = function (this: StubXhr, ...args) {
      return hexclaveSend.apply(this, args);
    };
    const laterSetRequestHeader: StubXhr["setRequestHeader"] = function (this: StubXhr, ...args) {
      return hexclaveSetRequestHeader.apply(this, args);
    };
    StubXhr.prototype.open = laterOpen;
    StubXhr.prototype.send = laterSend;
    StubXhr.prototype.setRequestHeader = laterSetRequestHeader;

    uninstall?.();
    uninstall = undefined;
    expect(StubXhr.prototype.open).toBe(laterOpen);
    expect(StubXhr.prototype.send).toBe(laterSend);
    expect(StubXhr.prototype.setRequestHeader).toBe(laterSetRequestHeader);

    StubXhr.prototype.open = originalOpen;
    StubXhr.prototype.send = originalSend;
    StubXhr.prototype.setRequestHeader = originalSetRequestHeader;
  });

  it("returns null when XMLHttpRequest is unavailable", () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    expect(installXhrSpanPropagation({
      getContext: () => null,
      getSelfOrigin: () => null,
      getAllowedOrigins: () => [],
    })).toBeNull();
  });
});
