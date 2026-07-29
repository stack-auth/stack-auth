import { buildTraceparent } from "@hexclave/shared/dist/utils/analytics-wire";
import { SPAN_CONTEXT_HEADER, encodeSpanContextHeader, type SpanPropagationContext } from "@hexclave/shared/dist/utils/span-context-codec";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import type { ParentRef, SpanRef } from "./event-tracker";

// The header codec lives in @hexclave/shared (the backend decodes the same
// header in parseAuth for tenant attribution — one codec, zero drift); this
// module re-exports it so SDK-internal consumers keep one import site.
export {
  SPAN_CONTEXT_HEADER,
  decodeSpanContextHeader,
  encodeSpanContextHeader,
  readSpanContextHeader,
  type SpanPropagationContext,
} from "@hexclave/shared/dist/utils/span-context-codec";

export type ParentSpanPathPart =
  | { kind: "known-path", ids: readonly string[] }
  | { kind: "declared-next", id: string };

function isParentPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((id, index) => path[index] === id);
}

function parentPathOverlap(left: readonly string[], right: readonly string[]): number {
  const maxLength = Math.min(left.length, right.length);
  for (let length = maxLength; length > 0; length -= 1) {
    const leftStart = left.length - length;
    if (right.slice(0, length).every((id, index) => left[leftStart + index] === id)) {
      return length;
    }
  }
  return 0;
}

/**
 * Merges parent information into one farthest-known-to-nearest-known path.
 *
 * Span refs carry a frozen path, so two refs are compatible only when one path
 * extends the other or their retained ends overlap (a capped path may have lost
 * its root). Raw ids have no ancestry metadata; their position in a `parentIds`
 * array explicitly declares that they follow the path built so far.
 */
export function mergeParentSpanPath(
  parts: readonly ParentSpanPathPart[],
): { ids: string[] } | { error: string } {
  let merged: string[] = [];

  for (const part of parts) {
    if (part.kind === "declared-next") {
      if (!merged.includes(part.id)) merged.push(part.id);
      continue;
    }

    if (new Set(part.ids).size !== part.ids.length) {
      return { error: "A parent span path must not contain duplicate span ids" };
    }
    if (merged.length === 0 || isParentPathPrefix(merged, part.ids)) {
      merged = [...part.ids];
      continue;
    }
    if (isParentPathPrefix(part.ids, merged)) continue;
    const forwardOverlap = parentPathOverlap(merged, part.ids);
    if (forwardOverlap > 0) {
      const candidate = [...merged, ...part.ids.slice(forwardOverlap)];
      if (new Set(candidate).size !== candidate.length) {
        return { error: "A parent span path must not contain duplicate span ids" };
      }
      merged = candidate;
      continue;
    }
    const backwardOverlap = parentPathOverlap(part.ids, merged);
    if (backwardOverlap > 0) {
      const candidate = [...part.ids.slice(0, -backwardOverlap), ...merged];
      if (new Set(candidate).size !== candidate.length) {
        return { error: "A parent span path must not contain duplicate span ids" };
      }
      merged = candidate;
      continue;
    }

    return {
      error: "Parent spans must describe one ancestry path; unrelated or sibling span refs cannot both be structural parents",
    };
  }

  return { ids: merged };
}

/**
 * Cross-tier span propagation.
 *
 * When a browser calls the customer's OWN backend, we want a server span (opened
 * via `serverApp.withSpan(type, { request }, ...)`) to automatically parent under
 * the caller's client session — the `$session-replay-segment` / `$session-replay`
 * / `$refresh-token` chain — with zero glue in the customer's code.
 *
 * The browser attaches ONE header, `x-hexclave-span-context`, to same-origin
 * outgoing requests. The server reads it, resolves the caller's refresh token from
 * the request session (the ONE trusted parent), and forwards the raw ids to the
 * ingestion route, which composes the system-prefixed parents (`rti-`/`sri-`/`srsi-`)
 * exactly like it does for browser events.
 *
 * Trust model: the header is CLIENT-CONTROLLED, so `sessionReplayId` /
 * `sessionReplaySegmentId` / custom parents are untrusted labels — fine for
 * best-effort telemetry, never for authz/billing/security. Only the refresh token
 * (server-derived), userId, project, and branch are trusted. Invalid/oversized/
 * unknown-version headers are ignored, never surfaced as an error.
 */

/**
 * Merges ambient parent refs (+ optional explicit extras) into the single
 * farthest-known-to-nearest-known path the header carries. Each ref contributes
 * its full frozen path (`[...parentSpanIds, spanId]`); incompatible branches are
 * rejected rather than flattened. Raw ids declare successive parents in their
 * array order. The codec drops malformed ids on decode and the backend
 * re-validates them.
 */
export function resolveParentRefsToPath(refs: SpanRef[], extraParents?: ParentRef[]): string[] {
  const parts: ParentSpanPathPart[] = refs.map((ref) => ({
    kind: "known-path",
    ids: [...ref.parentSpanIds, ref.spanId],
  }));
  for (const parent of extraParents ?? []) {
    if (typeof parent === "string") {
      parts.push({ kind: "declared-next", id: parent });
    } else {
      const ref: SpanRef = "ref" in parent && typeof parent.ref === "function" ? parent.ref() : parent as SpanRef;
      parts.push({ kind: "known-path", ids: [...ref.parentSpanIds, ref.spanId] });
    }
  }
  const merged = mergeParentSpanPath(parts);
  if ("error" in merged) {
    throw new Error(`Hexclave analytics: ${merged.error}`);
  }
  return merged.ids;
}

/**
 * Whether the span-context header may ride along to `targetUrl`. Default policy is
 * SAME-ORIGIN ONLY: attaching a custom header cross-origin both leaks the context
 * to third parties and forces a CORS preflight that the third party won't allow,
 * breaking the customer's request. `allowedOrigins` opts specific extra origins in
 * (e.g. a split `api.example.com`), matched by exact origin. `allowLocalhost`
 * additionally admits any localhost/loopback target (set from the project's
 * `allow_localhost` dev flag — split-port local dev like `:3000` → `:3001` is
 * unenumerable as exact origins, and the exposure of a header to another
 * process on the developer's own machine is not the boundary this policy
 * defends). Non-http(s) targets and unparseable urls are always excluded.
 */
export function shouldPropagateSpanContext(opts: {
  targetUrl: string | URL,
  selfOrigin: string | null,
  allowedOrigins?: readonly string[],
  allowLocalhost?: boolean,
}): boolean {
  let target: URL;
  try {
    target = typeof opts.targetUrl === "string"
      ? new URL(opts.targetUrl, opts.selfOrigin ?? undefined)
      : opts.targetUrl;
  } catch {
    return false;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (opts.selfOrigin !== null && target.origin === opts.selfOrigin) return true;
  if (opts.allowedOrigins?.includes(target.origin) === true) return true;
  return opts.allowLocalhost === true && isLocalhost(target);
}

/**
 * Derives the exact origins the propagation policy admits from the project's
 * configured trusted domains (the same list that guards auth redirects — a
 * boundary the customer already maintains, which is what makes it a safe
 * zero-config default for the split frontend/api case). Only non-wildcard
 * entries qualify: propagation matches exact origins on purpose (fail-closed),
 * and expanding `https://*.example.com` into a pattern match would silently
 * loosen that. Invalid entries are skipped, not fatal — one bad domain in the
 * dashboard must not break propagation for the rest.
 */
export function trustedDomainsToPropagationOrigins(trustedDomains: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const domain of trustedDomains) {
    if (domain.includes("*")) continue;
    let url: URL;
    try {
      url = new URL(domain);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    origins.add(url.origin);
  }
  return [...origins];
}

/** Marker on globalThis so the fetch wrapper installs at most once (HMR / multiple app instances). */
const FETCH_WRAP_MARKER = "__hexclaveSpanPropagationFetch";

function requestInputUrl(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && typeof (input as { url?: unknown }).url === "string") {
    return (input as { url: string }).url; // Request
  }
  return null;
}

function requestInputMode(input: unknown, init: RequestInit | undefined): string | undefined {
  if (init?.mode) return init.mode;
  if (typeof input === "object" && input !== null && typeof (input as { mode?: unknown }).mode === "string") {
    return (input as { mode: string }).mode;
  }
  return undefined;
}

function requestInputMethod(input: unknown, init: RequestInit | undefined): string {
  if (typeof init?.method === "string" && init.method !== "") return init.method.toUpperCase();
  if (typeof input === "object" && input !== null && typeof (input as { method?: unknown }).method === "string") {
    return (input as { method: string }).method.toUpperCase(); // Request
  }
  return "GET";
}

/** The absolute http(s) URL of a request target, or null when it cannot be
 * resolved (non-http(s) scheme, unparseable, or relative without a base). */
export function resolveHttpRequestUrl(rawUrl: string, selfOrigin: string | null): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, selfOrigin ?? undefined);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/**
 * Ends all spans opened for one request when its fetch promise settles —
 * on RESPONSE HEADERS for successes (never the body stream: a span that only
 * closed at body completion would misreport streaming responses as slow), and
 * on rejection for failures. The derived promise is fully handled here, so an
 * uncaught rejection remains exactly the caller's to observe.
 */
function endRequestSpansOnSettle(
  promise: Promise<Response>,
  opened: readonly { span: RequestSpanHandle, propagated: boolean }[],
): void {
  const endAll = (outcome: { status?: number, errored: boolean, aborted: boolean }) => {
    for (const entry of opened) {
      try {
        entry.span.end({ ...outcome, propagated: entry.propagated });
      } catch {
        // Ending a span must never throw into the caller's request handling.
      }
    }
  };
  promise.then(
    (response) => {
      // Runtime-guarded despite the Response type: fetch stubs/polyfills may
      // resolve with partial objects, and a missing status must not become NaN.
      const status = typeof response.status === "number" ? response.status : undefined;
      endAll({ status, errored: false, aborted: false });
    },
    (error: unknown) => {
      endAll({ errored: true, aborted: isAbortError(error) });
    },
  );
}

/**
 * Builds the RequestInit for attaching a span-context header to one fetch call,
 * or returns null when the header must NOT be attached: `no-cors` mode (custom
 * headers are stripped there anyway), a target outside the origin policy
 * (unless `bypassOriginPolicy` — server-side explicit span.fetch, where CORS
 * does not exist and the call itself is the intent), or a header the caller
 * already set explicitly (their precise intent always wins). Reproduces native
 * header precedence — init.headers over a Request's own headers — and never
 * mutates the caller's objects. Shared by the auto fetch wrapper and span.fetch.
 */
export function buildFetchInitWithSpanContext(opts: {
  input: unknown,
  init: RequestInit | undefined,
  headerValue: string,
  selfOrigin: string | null,
  allowedOrigins: readonly string[],
  allowLocalhost?: boolean,
  bypassOriginPolicy?: boolean,
}): RequestInit | null {
  if (requestInputMode(opts.input, opts.init) === "no-cors") return null;
  if (!opts.bypassOriginPolicy) {
    const url = requestInputUrl(opts.input);
    if (url === null) return null;
    if (!shouldPropagateSpanContext({ targetUrl: url, selfOrigin: opts.selfOrigin, allowedOrigins: opts.allowedOrigins, allowLocalhost: opts.allowLocalhost })) return null;
  }
  const isRequest = typeof Request !== "undefined" && opts.input instanceof Request;
  const base: HeadersInit | undefined = opts.init?.headers !== undefined
    ? opts.init.headers
    : (isRequest ? (opts.input as Request).headers : undefined);
  const headers = new Headers(base);
  if (headers.has(SPAN_CONTEXT_HEADER)) return null;
  headers.set(SPAN_CONTEXT_HEADER, opts.headerValue);
  return { ...opts.init, headers };
}

export type RequestSpanInfo = {
  /** Absolute http(s) URL of the outgoing request (resolved against selfOrigin). */
  url: string,
  method: string,
  transport: "fetch" | "xhr",
};

export type RequestSpanOutcome = {
  /** Response status; omitted when the request never produced response headers. */
  status?: number,
  errored: boolean,
  aborted: boolean,
  /** True when this span's uuid actually rode the outgoing span-context header. */
  propagated?: boolean,
};

/**
 * Structurally matches network-capture's HttpRequestSpanHandle — declared here
 * (instead of imported) so this module stays decoupled from the span state
 * machine: the wrapper only needs an id and an end callback.
 */
export type RequestSpanHandle = {
  spanUuid: string,
  /**
   * Whether the span's uuid may be promised to the backend via
   * `httpClientSpanId` + `traceparent`. False for spans that are only
   * tentatively kept (sampled-out / errors-only capture): a traceparent must
   * always point at a stored span. Default true when omitted.
   */
  propagate?: boolean,
  end: (outcome: RequestSpanOutcome) => void,
};

export type FetchSpanPropagationOptions = {
  /** The current ambient client context, or null when there is nothing to link. */
  getContext: () => SpanPropagationContext | null,
  /** The page's own origin (e.g. `window.location.origin`), or null if unknown. */
  getSelfOrigin: () => string | null,
  /** Extra exact origins allowed to receive the header (split frontend/api domains). */
  getAllowedOrigins: () => readonly string[],
  /** Whether localhost/loopback targets may receive the header (dev-only
   * convenience, sourced from the project's `allow_localhost`). Optional so
   * existing providers keep their exact-origins-only behavior. */
  getAllowLocalhostOrigins?: () => boolean,
  /**
   * Opens a `$http-client` span for one outgoing request, or null when the
   * request must not be recorded (capture disabled, SDK-own URL, filtered
   * origin). Called for EVERY http(s) request — span creation is local, so
   * unlike the header it has no CORS side effect and is independent of the
   * origin policy. The wrapper calls `end` exactly once, when response
   * HEADERS arrive or the request settles with an error (the body stream is
   * never touched).
   */
  beginRequestSpan?: (info: RequestSpanInfo) => RequestSpanHandle | null,
};

type FetchSpanPropagationState = {
  originalFetch: typeof fetch,
  wrappedFetch: typeof fetch,
  providers: Set<FetchSpanPropagationOptions>,
};

function getFetchSpanPropagationState(): FetchSpanPropagationState | null {
  const value = (globalThis as typeof globalThis & Record<string, unknown>)[FETCH_WRAP_MARKER];
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<FetchSpanPropagationState>;
  if (typeof candidate.originalFetch !== "function" || typeof candidate.wrappedFetch !== "function") return null;
  if (!(candidate.providers instanceof Set)) return null;
  return candidate as FetchSpanPropagationState;
}

/**
 * Installs a global `fetch` wrapper that attaches `x-hexclave-span-context` to
 * same-origin (or allowlisted) outgoing requests. Idempotent (a global marker
 * guards against HMR / multiple app instances). Every app registers a provider;
 * the wrapper attaches a header only when all eligible providers agree on the
 * same context. Ambiguous same-origin multi-project requests fail closed instead
 * of silently labeling one project's traffic as another's. It chains through the
 * existing fetch so it composes with other wrappers (Sentry/OTel), and never lets
 * propagation throw into the caller's request. Returns an uninstaller, or null if
 * fetch is unavailable or a foreign value already occupies the marker.
 */
export function installFetchSpanPropagation(options: FetchSpanPropagationOptions): (() => void) | null {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  if (typeof g.fetch !== "function") return null;
  const existingState = getFetchSpanPropagationState();
  if (existingState) {
    existingState.providers.add(options);
    return () => {
      existingState.providers.delete(options);
      if (existingState.providers.size !== 0) return;
      if (g.fetch === existingState.wrappedFetch) g.fetch = existingState.originalFetch;
      if (g[FETCH_WRAP_MARKER] === existingState) delete g[FETCH_WRAP_MARKER];
    };
  }
  if (g[FETCH_WRAP_MARKER]) return null;

  // Keep the exact original reference to restore on uninstall, but call it bound —
  // an unbound `fetch` throws "Illegal invocation" in browsers.
  const originalFetch = g.fetch as typeof fetch;
  const callFetch = originalFetch.bind(globalThis) as typeof fetch;
  const state: FetchSpanPropagationState = {
    originalFetch,
    wrappedFetch: originalFetch,
    providers: new Set([options]),
  };

  const wrapped = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    type SpanEntry = { span: RequestSpanHandle, propagated: boolean };
    const openedSpans: SpanEntry[] = [];
    const candidates = new Map<string, { init: RequestInit, spanEntry: SpanEntry | null }>();
    for (const provider of state.providers) {
      try {
        // `$http-client` span creation happens for EVERY http(s) request,
        // independent of the header origin policy: creating a span is a local
        // write with no CORS side effect. With multiple providers, each
        // eligible provider opens its own span (correct per-project
        // attribution); only HEADER attachment keeps the fail-closed
        // single-candidate rule below.
        let spanEntry: SpanEntry | null = null;
        if (provider.beginRequestSpan) {
          const rawUrl = requestInputUrl(input);
          const absoluteUrl = rawUrl === null ? null : resolveHttpRequestUrl(rawUrl, provider.getSelfOrigin());
          if (absoluteUrl !== null) {
            const span = provider.beginRequestSpan({ url: absoluteUrl, method: requestInputMethod(input, init), transport: "fetch" });
            if (span) {
              spanEntry = { span, propagated: false };
              openedSpans.push(spanEntry);
            }
          }
        }
        const context = provider.getContext();
        if (!context) continue;
        // The span's uuid rides the header only when the span is guaranteed to
        // be stored (propagate !== false) — bridge coherence: httpClientSpanId
        // and the traceparent below must always point at a stored span. When
        // no span was created (capture disabled / filtered / sampled out), the
        // context header still rides WITHOUT httpClientSpanId and no
        // traceparent is emitted.
        const propagatableSpan = spanEntry !== null && spanEntry.span.propagate !== false ? spanEntry : null;
        const headerValue = encodeSpanContextHeader(
          propagatableSpan !== null ? { ...context, httpClientSpanId: propagatableSpan.span.spanUuid } : context,
        );
        const initWithHeader = buildFetchInitWithSpanContext({
          input,
          init,
          headerValue,
          selfOrigin: provider.getSelfOrigin(),
          allowedOrigins: provider.getAllowedOrigins(),
          allowLocalhost: provider.getAllowLocalhostOrigins?.() ?? false,
        });
        if (initWithHeader) candidates.set(headerValue, { init: initWithHeader, spanEntry: propagatableSpan });
      } catch {
        // A broken provider must not affect the request or the other providers.
      }
    }
    let finalInit = init;
    if (candidates.size === 1) {
      const candidate = candidates.values().next();
      if (!candidate.done) {
        finalInit = candidate.value.init;
        const spanEntry = candidate.value.spanEntry;
        if (spanEntry !== null) {
          spanEntry.propagated = true;
          try {
            // The W3C bridge: `traceparent` derives deterministically from the
            // $http-client span's uuid, so backend OTel spans of this request
            // share a trace id computable from the client span. Caller intent
            // wins — an explicitly-set traceparent is never overwritten.
            // (no-cors requests never reach here: buildFetchInitWithSpanContext
            // already excluded them.)
            const headers = new Headers(finalInit.headers);
            if (!headers.has("traceparent")) {
              headers.set("traceparent", buildTraceparent(spanEntry.span.spanUuid));
              finalInit = { ...finalInit, headers };
            }
          } catch {
            // The span-context header still rides even if traceparent fails.
          }
        }
      }
    }
    let promise: Promise<Response>;
    try {
      promise = callFetch(input, finalInit);
    } catch (error) {
      // A synchronously-throwing fetch (misbehaving polyfill/stub) must still
      // close the spans we opened, then propagate unchanged to the caller.
      for (const entry of openedSpans) {
        try {
          entry.span.end({ errored: true, aborted: isAbortError(error), propagated: entry.propagated });
        } catch {
          // Never let span teardown mask the original error.
        }
      }
      throw error;
    }
    if (openedSpans.length > 0) {
      endRequestSpansOnSettle(promise, openedSpans);
    }
    return promise;
  }) as typeof fetch;

  state.wrappedFetch = wrapped;
  g.fetch = wrapped;
  g[FETCH_WRAP_MARKER] = state;

  return () => {
    state.providers.delete(options);
    if (state.providers.size !== 0) return;
    if (g.fetch === wrapped) g.fetch = originalFetch;
    if (g[FETCH_WRAP_MARKER] === state) delete g[FETCH_WRAP_MARKER];
  };
}
