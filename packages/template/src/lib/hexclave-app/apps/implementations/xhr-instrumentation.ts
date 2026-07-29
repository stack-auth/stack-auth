import { buildTraceparent } from "@hexclave/shared/dist/utils/analytics-wire";
import {
  SPAN_CONTEXT_HEADER,
  encodeSpanContextHeader,
  isAbortError,
  resolveHttpRequestUrl,
  shouldPropagateSpanContext,
  type FetchSpanPropagationOptions,
  type RequestSpanHandle,
} from "./span-propagation";

/**
 * XMLHttpRequest counterpart of the fetch wrapper in span-propagation.ts:
 * attaches the `x-hexclave-span-context` header (same origin policy, same
 * fail-closed single-candidate rule across providers) and opens one
 * `$http-client` span per request through the same `beginRequestSpan` provider
 * hook (`transport: "xhr"`). Installed alongside the fetch wrapper so
 * XHR-based HTTP layers (axios' default browser adapter, older SDKs) get the
 * same cross-tier bridge.
 *
 * Prototype patching instead of per-instance wrapping: requests are created by
 * third-party code, so `open`/`send`/`setRequestHeader` on
 * `XMLHttpRequest.prototype` are the only interception points. Idempotent via
 * a global marker (HMR / multiple app instances share one patch with a
 * provider registry), and everything the patch does is wrapped so propagation
 * can never throw into the caller's request.
 */

/** Marker on globalThis so the XHR patch installs at most once. */
const XHR_WRAP_MARKER = "__hexclaveSpanPropagationXhr";

type XhrRequestState = {
  method: string,
  rawUrl: string,
  // Caller intent always wins: a span-context or traceparent header the
  // caller set explicitly via setRequestHeader is never overwritten (we do
  // not even attach ours — XHR joins repeated setRequestHeader values with
  // ", ", which would corrupt both).
  callerSetSpanContext: boolean,
  callerSetTraceparent: boolean,
};

type XhrSpanPropagationState = {
  originalOpen: XMLHttpRequest["open"],
  originalSend: XMLHttpRequest["send"],
  originalSetRequestHeader: XMLHttpRequest["setRequestHeader"],
  wrappedMethods?: {
    open?: XMLHttpRequest["open"],
    send?: XMLHttpRequest["send"],
    setRequestHeader?: XMLHttpRequest["setRequestHeader"],
  },
  providers: Set<FetchSpanPropagationOptions>,
  requests: WeakMap<XMLHttpRequest, XhrRequestState>,
};

function getXhrSpanPropagationState(): XhrSpanPropagationState | null {
  const value = (globalThis as typeof globalThis & Record<string, unknown>)[XHR_WRAP_MARKER];
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<XhrSpanPropagationState>;
  if (typeof candidate.originalOpen !== "function" || typeof candidate.originalSend !== "function" || typeof candidate.originalSetRequestHeader !== "function") return null;
  if (!(candidate.providers instanceof Set) || !(candidate.requests instanceof WeakMap)) return null;
  return candidate as XhrSpanPropagationState;
}

/**
 * Installs the XHR patch (idempotent; every app registers a provider like the
 * fetch wrapper). Returns an uninstaller, or null when XMLHttpRequest is
 * unavailable (non-browser runtimes) or a foreign value occupies the marker.
 */
export function installXhrSpanPropagation(options: FetchSpanPropagationOptions): (() => void) | null {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  if (typeof g.XMLHttpRequest !== "function") return null;
  const existingState = getXhrSpanPropagationState();
  if (existingState) {
    existingState.providers.add(options);
    return () => uninstallProvider(existingState, options);
  }
  if (g[XHR_WRAP_MARKER]) return null;

  const proto = (g.XMLHttpRequest as typeof XMLHttpRequest).prototype;
  const state: XhrSpanPropagationState = {
    originalOpen: proto.open,
    originalSend: proto.send,
    originalSetRequestHeader: proto.setRequestHeader,
    wrappedMethods: {},
    providers: new Set([options]),
    requests: new WeakMap(),
  };

  const wrappedOpen = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["open"]>): void {
    try {
      const [method, url] = args;
      // Re-opening a request resets its headers per the XHR spec, so the
      // caller-set flags reset with it.
      state.requests.set(this, {
        method: typeof method === "string" && method !== "" ? method.toUpperCase() : "GET",
        rawUrl: typeof url === "string" ? url : String(url),
        callerSetSpanContext: false,
        callerSetTraceparent: false,
      });
    } catch {
      // Bookkeeping failure must not affect the caller's request.
    }
    return state.originalOpen.apply(this, args);
  };
  // The wrapper replays the arguments with exact arity via apply, so it honors
  // both `open` overloads at runtime — but TS cannot express "a function with
  // the same overloads as the wrapped one" for a rest-tuple implementation
  // (Parameters<> picks only the widest overload), so the assignment needs a
  // cast. Any arity/type mismatch would still be caught by the calls in this
  // module's tests.
  proto.open = wrappedOpen as XMLHttpRequest["open"];

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string): void {
    try {
      const request = state.requests.get(this);
      if (request && typeof name === "string") {
        const lower = name.toLowerCase();
        if (lower === SPAN_CONTEXT_HEADER) request.callerSetSpanContext = true;
        if (lower === "traceparent") request.callerSetTraceparent = true;
      }
    } catch {
      // See above.
    }
    return state.originalSetRequestHeader.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>): void {
    type SpanEntry = { span: RequestSpanHandle, propagated: boolean };
    const openedSpans: SpanEntry[] = [];
    try {
      const request = state.requests.get(this);
      if (request) {
        const candidates = new Map<string, { spanEntry: SpanEntry | null }>();
        for (const provider of state.providers) {
          try {
            const absoluteUrl = resolveHttpRequestUrl(request.rawUrl, provider.getSelfOrigin());
            if (absoluteUrl === null) continue;
            // Span creation for every http(s) request, independent of the
            // header policy — mirrors the fetch wrapper exactly.
            let spanEntry: SpanEntry | null = null;
            if (provider.beginRequestSpan) {
              const span = provider.beginRequestSpan({ url: absoluteUrl, method: request.method, transport: "xhr" });
              if (span) {
                spanEntry = { span, propagated: false };
                openedSpans.push(spanEntry);
              }
            }
            if (request.callerSetSpanContext) continue;
            const context = provider.getContext();
            if (!context) continue;
            if (!shouldPropagateSpanContext({ targetUrl: absoluteUrl, selfOrigin: provider.getSelfOrigin(), allowedOrigins: provider.getAllowedOrigins(), allowLocalhost: provider.getAllowLocalhostOrigins?.() ?? false })) continue;
            const propagatableSpan = spanEntry !== null && spanEntry.span.propagate !== false ? spanEntry : null;
            const headerValue = encodeSpanContextHeader(
              propagatableSpan !== null ? { ...context, httpClientSpanId: propagatableSpan.span.spanUuid } : context,
            );
            candidates.set(headerValue, { spanEntry: propagatableSpan });
          } catch {
            // A broken provider must not affect the request or the other providers.
          }
        }
        if (candidates.size === 1) {
          const candidate = candidates.entries().next();
          if (!candidate.done) {
            const [headerValue, { spanEntry }] = candidate.value;
            // The ORIGINAL setRequestHeader: the patched one would record our
            // own header as caller intent.
            state.originalSetRequestHeader.call(this, SPAN_CONTEXT_HEADER, headerValue);
            if (spanEntry !== null) {
              spanEntry.propagated = true;
              if (!request.callerSetTraceparent) {
                state.originalSetRequestHeader.call(this, "traceparent", buildTraceparent(spanEntry.span.spanUuid));
              }
            }
          }
        }
      }
      if (openedSpans.length > 0) {
        let aborted = false;
        this.addEventListener("abort", () => {
          aborted = true;
        }, { once: true });
        // `loadend` fires exactly once for every terminal state (load, error,
        // abort, timeout). Status 0 means the request never produced response
        // headers (network error / abort / timeout).
        this.addEventListener("loadend", () => {
          const status = typeof this.status === "number" && this.status > 0 ? this.status : undefined;
          for (const entry of openedSpans) {
            try {
              entry.span.end({
                ...status !== undefined ? { status } : {},
                errored: status === undefined,
                aborted,
                propagated: entry.propagated,
              });
            } catch {
              // Never throw out of an XHR event listener.
            }
          }
        }, { once: true });
      }
    } catch {
      // Instrumentation failure: fall through and send the request untouched.
    }
    try {
      return state.originalSend.apply(this, args);
    } catch (error) {
      // A synchronously-throwing send (bad state) fires no loadend for our
      // listeners in some engines; close the spans before propagating.
      for (const entry of openedSpans) {
        try {
          entry.span.end({ errored: true, aborted: isAbortError(error), propagated: entry.propagated });
        } catch {
          // Never mask the original error.
        }
      }
      throw error;
    }
  };

  state.wrappedMethods = {
    open: proto.open,
    send: proto.send,
    setRequestHeader: proto.setRequestHeader,
  };
  g[XHR_WRAP_MARKER] = state;

  return () => uninstallProvider(state, options);
}

function uninstallProvider(state: XhrSpanPropagationState, options: FetchSpanPropagationOptions): void {
  state.providers.delete(options);
  if (state.providers.size !== 0) return;
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  if (typeof g.XMLHttpRequest === "function") {
    const proto = (g.XMLHttpRequest as typeof XMLHttpRequest).prototype;
    if (state.wrappedMethods?.open !== undefined && proto.open === state.wrappedMethods.open) {
      proto.open = state.originalOpen;
    }
    if (state.wrappedMethods?.send !== undefined && proto.send === state.wrappedMethods.send) {
      proto.send = state.originalSend;
    }
    if (state.wrappedMethods?.setRequestHeader !== undefined && proto.setRequestHeader === state.wrappedMethods.setRequestHeader) {
      proto.setRequestHeader = state.originalSetRequestHeader;
    }
  }
  if (g[XHR_WRAP_MARKER] === state) delete g[XHR_WRAP_MARKER];
}
