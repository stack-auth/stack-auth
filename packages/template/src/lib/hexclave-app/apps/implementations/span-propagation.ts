import { formatTraceparent } from "@hexclave/shared/dist/utils/analytics-wire";
import { SPAN_CONTEXT_HEADER, encodeSpanContextHeader, type SpanPropagationContext } from "@hexclave/shared/dist/utils/span-context-codec";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import type { SpanContext } from "./event-tracker";

/** The standard W3C hierarchy carrier. Lowercase per spec; `Headers` is case-insensitive anyway. */
export const TRACEPARENT_HEADER = "traceparent";

// The header codec lives in @hexclave/shared (the backend decodes the same
// header in parseAuth for tenant attribution — one codec, zero drift); this
// module re-exports it so SDK-internal consumers keep one import site.
export {
  SPAN_CONTEXT_HEADER,
  decodeSpanContextHeader,
  encodeSpanContextHeader,
  readRequestHeader,
  readSpanContextHeader,
  type SpanPropagationContext,
} from "@hexclave/shared/dist/utils/span-context-codec";

/**
 * Cross-tier span propagation.
 *
 * When a browser calls the customer's OWN backend, a server span (opened via
 * `serverApp.withSpan(type, { request }, ...)`) should land in the SAME TRACE as
 * the client fetch that triggered it, with zero glue in the customer's code.
 *
 * TWO headers ride an eligible outgoing request, with a strict division of labour:
 *
 *  - `traceparent` (W3C standard) carries the HIERARCHY: the `$http-client` span's
 *    trace id + span id. This is what makes the backend's spans children of the
 *    client fetch, and it is the reason Hexclave traces interoperate with any other
 *    OTel-compatible tooling instead of needing a bespoke bridge.
 *  - `x-hexclave-span-context` carries only NON-HIERARCHICAL correlation (replay /
 *    segment / page-view ids). It exists because those facts have no home in the
 *    W3C standard, not because they describe ancestry.
 *
 * Trust model: both headers are CLIENT-CONTROLLED, so every id in them is an
 * untrusted label — fine for best-effort telemetry, never for authz/billing/
 * security. Only the refresh token (server-derived from the session), userId,
 * project, and branch are trusted. Invalid/oversized/unknown-version headers are
 * ignored, never surfaced as an error.
 */

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
  /** Header name -> value. Names the caller already set are skipped individually. */
  headerValues: Readonly<Record<string, string>>,
  selfOrigin: string | null,
  allowedOrigins: readonly string[],
  allowLocalhost?: boolean,
  bypassOriginPolicy?: boolean,
}): { init: RequestInit, attachedHeaderNames: Set<string> } | null {
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
  // Per-header precedence, not all-or-nothing: a caller who pinned `traceparent`
  // by hand still gets our correlation header, and vice versa.
  const attachedHeaderNames = new Set<string>();
  for (const [name, value] of Object.entries(opts.headerValues)) {
    if (headers.has(name)) continue;
    headers.set(name, value);
    attachedHeaderNames.add(name);
  }
  if (attachedHeaderNames.size === 0) return null;
  return { init: { ...opts.init, headers }, attachedHeaderNames };
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
  /** True when this span's context actually rode the outgoing `traceparent`. */
  propagated?: boolean,
};

/**
 * Structurally matches network-capture's HttpRequestSpanHandle — declared here
 * (instead of imported) so this module stays decoupled from the span state
 * machine: the wrapper only needs an identity and an end callback.
 */
export type RequestSpanHandle = {
  spanContext: SpanContext,
  /**
   * Whether this span is guaranteed to remain available as a parent. False for
   * maybe-kept spans and pre-load rows that can be discarded during a session
   * rotation. Default true when omitted.
   */
  propagate?: boolean,
  end: (outcome: RequestSpanOutcome) => void,
};

/** Whether a context carries any correlation id, i.e. anything beyond the project claim. */
function hasCorrelationIds(context: SpanPropagationContext): boolean {
  return context.sessionReplayId !== undefined
    || context.sessionReplaySegmentId !== undefined
    || context.pageViewSpanId !== undefined;
}

/**
 * The propagation headers for one outgoing request — the single place that
 * decides WHETHER each header is worth sending, so the fetch wrapper, the XHR
 * wrapper, the pinned-span helpers and the public `getSpanPropagationHeaders`
 * cannot drift.
 *
 * Returns `{}` when there is nothing to state (no span AND no correlation ids).
 * The wrappers treat that as "this provider has nothing to say", which keeps it
 * out of their fail-closed single-candidate count.
 *
 * The span-context header rides whenever a `traceparent` does, EVEN with no
 * correlation ids to carry: its `projectId` is the receiver's only way to tell
 * whether the span named by `traceparent` is one this project can see. Without
 * that claim the receiver must drop the parent (see the backend's
 * customer-request-observability), because a parent no row in the project can
 * satisfy makes the child neither a child nor a root — it vanishes from traces.
 */
export function buildPropagationHeaderValues(opts: {
  traceparent: { traceId: string, spanId: string, sampled: boolean } | null,
  context: SpanPropagationContext | null,
}): Record<string, string> {
  const worthSending = opts.traceparent !== null || (opts.context !== null && hasCorrelationIds(opts.context));
  if (!worthSending) return {};
  return {
    ...opts.traceparent !== null ? { [TRACEPARENT_HEADER]: formatTraceparent(opts.traceparent) } : {},
    ...opts.context !== null ? { [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader(opts.context) } : {},
  };
}

export type FetchSpanPropagationOptions = {
  /**
   * The current ambient CORRELATION context, or null when propagation is off
   * entirely. Note this no longer gates `traceparent`: an outgoing request with a
   * `$http-client` span always propagates its hierarchy, even with no replay /
   * page-view context to report — the context is then the bare project claim
   * that makes the propagated hierarchy usable (see buildPropagationHeaderValues).
   */
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
 * Installs a global `fetch` wrapper that attaches `traceparent` +
 * `x-hexclave-span-context` to same-origin (or allowlisted) outgoing requests.
 * Idempotent (a global marker guards against HMR / multiple app instances).
 *
 * Every app registers a provider. The wrapper attaches headers only when exactly
 * ONE eligible provider wants to, so ambiguous same-origin multi-project requests
 * fail closed instead of silently labeling one project's traffic as another's —
 * and, now that `traceparent` is in the bag, instead of joining a request to an
 * arbitrary one of two candidate traces.
 *
 * It chains through the existing fetch so it composes with other wrappers
 * (Sentry/OTel), and never lets propagation throw into the caller's request.
 * Returns an uninstaller, or null if fetch is unavailable or a foreign value
 * already occupies the marker.
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
    const candidates = new Map<string, { init: RequestInit, attachedHeaderNames: Set<string>, spanEntry: SpanEntry | null }>();
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
        // A traceparent is a concrete parent edge, so it may name only a span
        // that this provider has guaranteed will be retained. Maybe-kept and
        // pre-load spans remain useful local observations but cannot safely
        // parent a remote subtree.
        const propagatableSpan = spanEntry !== null && spanEntry.span.propagate !== false
          ? spanEntry
          : null;
        const headerValues = buildPropagationHeaderValues({
          traceparent: propagatableSpan === null ? null : {
            ...propagatableSpan.span.spanContext,
            sampled: true,
          },
          context: provider.getContext(),
        });
        // Nothing to say about this request: no span opened and no correlation
        // context. Skipping keeps such a provider out of the fail-closed count.
        if (Object.keys(headerValues).length === 0) continue;
        const initWithHeaders = buildFetchInitWithSpanContext({
          input,
          init,
          headerValues,
          selfOrigin: provider.getSelfOrigin(),
          allowedOrigins: provider.getAllowedOrigins(),
          allowLocalhost: provider.getAllowLocalhostOrigins?.() ?? false,
        });
        // Keyed by the full header set so two providers that would send byte-identical
        // headers collapse to one candidate instead of tripping the fail-closed rule.
        if (initWithHeaders) {
          candidates.set(JSON.stringify(headerValues), {
            init: initWithHeaders.init,
            attachedHeaderNames: initWithHeaders.attachedHeaderNames,
            spanEntry: propagatableSpan,
          });
        }
      } catch {
        // A broken provider must not affect the request or the other providers.
      }
    }
    let finalInit = init;
    if (candidates.size === 1) {
      const candidate = candidates.values().next();
      if (!candidate.done) {
        finalInit = candidate.value.init;
        // Keyed on TRACEPARENT specifically, not on "some header of ours rode".
        // Those were the same fact when hierarchy travelled inside our own header;
        // under W3C they are not. If the caller pinned their own `traceparent`, our
        // correlation header still rides (per-header precedence) but the receiver
        // joins the CALLER's trace — so reporting propagated: 1 here would make the
        // span row claim a cross-tier link that does not exist.
        if (candidate.value.spanEntry !== null && candidate.value.attachedHeaderNames.has(TRACEPARENT_HEADER)) {
          candidate.value.spanEntry.propagated = true;
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
