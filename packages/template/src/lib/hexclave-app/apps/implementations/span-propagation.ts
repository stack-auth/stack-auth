import { decodeBase64Url, encodeBase64Url } from "@hexclave/shared/dist/utils/bytes";
import type { ParentRef, SpanRef } from "./event-tracker";

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

/** The single header carrying the client's ambient span context. */
export const SPAN_CONTEXT_HEADER = "x-hexclave-span-context";

/** Wire format is `${VERSION}.${base64url(json)}` so we can evolve the payload. */
const SPAN_CONTEXT_VERSION = "v1";

/**
 * Cap on the custom parent chain carried in the header. Mirrors `MAX_PARENT_CHAIN`
 * in event-tracker.ts and the backend analytics-events route.
 */
const MAX_CUSTOM_PARENT_SPAN_IDS = 10;

/** Reject absurd header values before we spend work decoding them. */
const MAX_HEADER_LENGTH = 4096;

/** Mirrors the backend UUID_RE; the raw ids in the header must be span uuids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The client's ambient span context, carried across the wire as raw ids (no
 * `rti-`/`sri-`/`srsi-`/`cs-` prefixes — those are applied server-side). `projectId`
 * lets the receiver ignore a header that belongs to a different Hexclave project.
 */
export type SpanPropagationContext = {
  projectId: string,
  sessionReplayId?: string,
  sessionReplaySegmentId?: string,
  /** The sender's current `$page-view` span, so backend telemetry triggered by
   * this request nests under the page the user was on. Untrusted label, like
   * the replay/segment ids. */
  pageViewSpanId?: string,
  customParentSpanIds?: string[],
};

/**
 * Flattens ambient parent refs (+ optional explicit extras) into the flat,
 * root-first, deduped id list the header carries. Each ref contributes its full
 * frozen chain (`[...parentSpanIds, spanId]`); explicit extras follow the same
 * ParentRef rules as parentIds elsewhere (a raw string contributes only itself).
 * Mirrors the merge in resolveParentIds, minus validation — the codec drops
 * malformed ids on decode and the backend re-validates.
 */
export function flattenParentRefsToIds(refs: SpanRef[], extraParents?: ParentRef[]): string[] {
  const chains: string[][] = refs.map((ref) => [...ref.parentSpanIds, ref.spanId]);
  for (const parent of extraParents ?? []) {
    if (typeof parent === "string") {
      chains.push([parent]);
    } else {
      const ref: SpanRef = "ref" in parent && typeof parent.ref === "function" ? parent.ref() : parent as SpanRef;
      chains.push([...ref.parentSpanIds, ref.spanId]);
    }
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const chain of chains) {
    for (const id of chain) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Header bag shape shared by browser `Headers` and node request-like objects. */
type RequestLikeHeaders = { get: (name: string) => string | null } | Record<string, string | null>;

/** Reads the span-context header from a request's headers (case-insensitive). */
export function readSpanContextHeader(headers: RequestLikeHeaders): string | null {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get: (name: string) => string | null }).get(SPAN_CONTEXT_HEADER);
  }
  const lower = SPAN_CONTEXT_HEADER.toLowerCase();
  for (const [name, value] of Object.entries(headers as Record<string, string | null>)) {
    if (name.toLowerCase() === lower) return value;
  }
  return null;
}

/** Serializes a context into the `x-hexclave-span-context` header value. */
export function encodeSpanContextHeader(context: SpanPropagationContext): string {
  const payload: Record<string, unknown> = { projectId: context.projectId };
  if (context.sessionReplayId) payload.sessionReplayId = context.sessionReplayId;
  if (context.sessionReplaySegmentId) payload.sessionReplaySegmentId = context.sessionReplaySegmentId;
  if (context.pageViewSpanId) payload.pageViewSpanId = context.pageViewSpanId;
  if (context.customParentSpanIds && context.customParentSpanIds.length > 0) {
    // Cap keeps the NEAREST ancestors (tail of a root-first list) — the same
    // overflow rule resolveParentIds applies to locally-tracked items.
    payload.customParentSpanIds = context.customParentSpanIds.slice(-MAX_CUSTOM_PARENT_SPAN_IDS);
  }
  const json = JSON.stringify(payload);
  return `${SPAN_CONTEXT_VERSION}.${encodeBase64Url(new TextEncoder().encode(json))}`;
}

/**
 * Parses a header value back into a context. Returns null for anything missing,
 * oversized, wrong-version, non-decodable, or structurally invalid — a bad header
 * must never throw into the request path. Individual fields are dropped (not
 * fatal) when they fail uuid validation, so a partially-corrupt header still
 * yields whatever ids are well-formed.
 */
export function decodeSpanContextHeader(headerValue: string | null | undefined): SpanPropagationContext | null {
  if (typeof headerValue !== "string" || headerValue.length === 0 || headerValue.length > MAX_HEADER_LENGTH) {
    return null;
  }
  const dot = headerValue.indexOf(".");
  if (dot === -1) return null;
  if (headerValue.slice(0, dot) !== SPAN_CONTEXT_VERSION) return null;

  let parsed: unknown;
  try {
    const json = new TextDecoder().decode(decodeBase64Url(headerValue.slice(dot + 1)));
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.projectId !== "string" || obj.projectId.length === 0) return null;

  const context: SpanPropagationContext = { projectId: obj.projectId };
  if (typeof obj.sessionReplayId === "string" && UUID_RE.test(obj.sessionReplayId)) {
    context.sessionReplayId = obj.sessionReplayId;
  }
  if (typeof obj.sessionReplaySegmentId === "string" && UUID_RE.test(obj.sessionReplaySegmentId)) {
    context.sessionReplaySegmentId = obj.sessionReplaySegmentId;
  }
  if (typeof obj.pageViewSpanId === "string" && UUID_RE.test(obj.pageViewSpanId)) {
    context.pageViewSpanId = obj.pageViewSpanId;
  }
  if (Array.isArray(obj.customParentSpanIds)) {
    const ids = obj.customParentSpanIds
      .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
      .slice(-MAX_CUSTOM_PARENT_SPAN_IDS);
    if (ids.length > 0) context.customParentSpanIds = ids;
  }
  return context;
}

/**
 * Whether the span-context header may ride along to `targetUrl`. Default policy is
 * SAME-ORIGIN ONLY: attaching a custom header cross-origin both leaks the context
 * to third parties and forces a CORS preflight that the third party won't allow,
 * breaking the customer's request. `allowedOrigins` opts specific extra origins in
 * (e.g. a split `api.example.com`), matched by exact origin. Non-http(s) targets
 * and unparseable urls are always excluded.
 */
export function shouldPropagateSpanContext(opts: {
  targetUrl: string | URL,
  selfOrigin: string | null,
  allowedOrigins?: readonly string[],
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
  return opts.allowedOrigins?.includes(target.origin) ?? false;
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
  bypassOriginPolicy?: boolean,
}): RequestInit | null {
  if (requestInputMode(opts.input, opts.init) === "no-cors") return null;
  if (!opts.bypassOriginPolicy) {
    const url = requestInputUrl(opts.input);
    if (url === null) return null;
    if (!shouldPropagateSpanContext({ targetUrl: url, selfOrigin: opts.selfOrigin, allowedOrigins: opts.allowedOrigins })) return null;
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

export type FetchSpanPropagationOptions = {
  /** The current ambient client context, or null when there is nothing to link. */
  getContext: () => SpanPropagationContext | null,
  /** The page's own origin (e.g. `window.location.origin`), or null if unknown. */
  getSelfOrigin: () => string | null,
  /** Extra exact origins allowed to receive the header (split frontend/api domains). */
  getAllowedOrigins: () => readonly string[],
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
    const candidates = new Map<string, RequestInit>();
    for (const provider of state.providers) {
      try {
        const context = provider.getContext();
        if (!context) continue;
        const headerValue = encodeSpanContextHeader(context);
        const initWithHeader = buildFetchInitWithSpanContext({
          input,
          init,
          headerValue,
          selfOrigin: provider.getSelfOrigin(),
          allowedOrigins: provider.getAllowedOrigins(),
        });
        if (initWithHeader) candidates.set(headerValue, initWithHeader);
      } catch {
        // A broken provider must not affect the request or the other providers.
      }
    }
    if (candidates.size === 1) {
      const candidate = candidates.values().next();
      if (!candidate.done) return callFetch(input, candidate.value);
    }
    return callFetch(input as RequestInfo | URL, init);
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
