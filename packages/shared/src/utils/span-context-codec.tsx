import { CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, TELEMETRY_UUID_RE } from "./analytics-wire";
import { decodeBase64Url, encodeBase64Url } from "./bytes";

// Codec for the `x-hexclave-span-context` cross-tier propagation header.
//
// Lives in @hexclave/shared (not the SDK template) because BOTH sides of the
// wire need it: the SDKs encode/decode it for customer apps, and the Hexclave
// backend decodes it in parseAuth to attribute its own OpenTelemetry
// self-instrumentation spans to the calling session. Keeping one codec is the
// only way the two cannot drift.
//
// Trust model (enforced by CONSUMERS, restated here because the codec is where
// people look first): the header is CLIENT-CONTROLLED. Every id in it is an
// untrusted label — fine for best-effort telemetry, never for authz/billing/
// security. Only the refresh token (server-derived from the session), userId,
// project, and branch are trusted. Invalid/oversized/unknown-version headers
// are ignored, never surfaced as an error.

/** The single header carrying the client's ambient span context. */
export const SPAN_CONTEXT_HEADER = "x-hexclave-span-context";

/** Wire format is `${VERSION}.${base64url(json)}` so we can evolve the payload. */
const SPAN_CONTEXT_VERSION = "v1";

/** Reject absurd header values before we spend work decoding them. */
const MAX_HEADER_LENGTH = 4096;

/**
 * The client's ambient span context, carried across the wire as raw ids (no
 * `rti-`/`sri-`/`srsi-`/`hc-`/`cs-` prefixes — those are applied server-side).
 * `projectId` lets the receiver ignore a header that belongs to a different
 * Hexclave project.
 */
export type SpanPropagationContext = {
  projectId: string,
  sessionReplayId?: string,
  sessionReplaySegmentId?: string,
  /** The sender's current `$page-view` span, so backend telemetry triggered by
   * this request nests under the page the user was on. Untrusted label, like
   * the replay/segment ids. */
  pageViewSpanId?: string,
  /** The `$http-client` span the SDK opened for THIS request — the cross-tier
   * bridge node. Its uuid also derives the W3C traceparent sent alongside, so
   * backend OTel spans of this request share a trace id computable from it.
   * Only present when the fetch instrumentation actually stored the span
   * (sampled-out requests carry neither this field nor a traceparent, keeping
   * bridge and sub-trace coherent). Additive v1 field: old decoders drop it. */
  httpClientSpanId?: string,
  customParentSpanIds?: string[],
};

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
  if (context.httpClientSpanId) payload.httpClientSpanId = context.httpClientSpanId;
  if (context.customParentSpanIds && context.customParentSpanIds.length > 0) {
    // Cap keeps the NEAREST ancestors (tail of a root-first list) — the same
    // overflow rule resolveParentIds applies to locally-tracked items.
    payload.customParentSpanIds = context.customParentSpanIds.slice(-CUSTOM_TELEMETRY_MAX_PARENT_CHAIN);
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
  if (typeof obj.sessionReplayId === "string" && TELEMETRY_UUID_RE.test(obj.sessionReplayId)) {
    context.sessionReplayId = obj.sessionReplayId;
  }
  if (typeof obj.sessionReplaySegmentId === "string" && TELEMETRY_UUID_RE.test(obj.sessionReplaySegmentId)) {
    context.sessionReplaySegmentId = obj.sessionReplaySegmentId;
  }
  if (typeof obj.pageViewSpanId === "string" && TELEMETRY_UUID_RE.test(obj.pageViewSpanId)) {
    context.pageViewSpanId = obj.pageViewSpanId;
  }
  if (typeof obj.httpClientSpanId === "string" && TELEMETRY_UUID_RE.test(obj.httpClientSpanId)) {
    context.httpClientSpanId = obj.httpClientSpanId;
  }
  if (Array.isArray(obj.customParentSpanIds)) {
    const ids = obj.customParentSpanIds
      .filter((id): id is string => typeof id === "string" && TELEMETRY_UUID_RE.test(id))
      .slice(-CUSTOM_TELEMETRY_MAX_PARENT_CHAIN);
    if (ids.length > 0) context.customParentSpanIds = ids;
  }
  return context;
}
