import { httpMethodNames } from "@/generated/route-modules";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import type { Event, EventHint } from "@sentry/node";

const knownHttpMethods = new Set<string>(httpMethodNames);

const safeSpanAttributeNames = new Set([
  "sentry.op",
  "sentry.origin",
  "sentry.source",
  "sentry.sample_rate",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "stack.process.concurrent-requests",
  "stack.process.id",
  "stack.request.method",
  "stack.request.request-id",
  "stack.smart-request.access-type",
  "stack.smart-request.client-version.platform",
  "stack.smart-request.client-version.sdk",
  "stack.smart-request.client-version.version",
]);

// These names are code-owned constants from the request pipeline. Keep this list
// default-deny: other custom span names may interpolate customer data (for example,
// the email sender used to include its recipient in the description).
const safeApplicationSpanDescriptions = new Set([
  "STACK: handling API request",
  "STACK: creating smart request",
  "STACK: smart request parseAuth",
  "STACK: validating smart request",
  "STACK: calling smart route handler callback",
  "STACK: validating smart response",
  "STACK: creating HTTP response from smart response",
]);

type BackendSentrySpan = NonNullable<Event["spans"]>[number];

function getSafeSpanData(data: BackendSentrySpan["data"]): BackendSentrySpan["data"] {
  return Object.fromEntries(
    Object.entries(data).filter(([attributeName]) => safeSpanAttributeNames.has(attributeName)),
  );
}

function getSafeRequestDescription(method: unknown, route: unknown): string | undefined {
  if (typeof method !== "string" || !knownHttpMethods.has(method)) {
    return undefined;
  }
  if (
    typeof route !== "string"
    || (route !== "<unmatched>" && !route.startsWith("/"))
    || route.length > 500
    || route.includes("?")
    || route.includes("#")
    || route.includes("://")
  ) {
    return undefined;
  }
  return `${method} ${route}`;
}

export function sanitizeBackendSentrySpan(span: BackendSentrySpan): BackendSentrySpan {
  // @sentry/node runs beforeSendSpan for the segment/root span as well as its
  // children. For a transaction, the SDK converts event.transaction into this
  // description and then converts it back after the hook; clearing it therefore
  // erases the transaction name entirely. Rebuild request names only from the
  // normalized route pattern, and preserve a small audited set of application
  // span names. Database statements, outbound URLs, and arbitrary custom names
  // remain stripped.
  span.description = getSafeRequestDescription(
    span.data["http.request.method"],
    span.data["http.route"],
  ) ?? (span.description != null && safeApplicationSpanDescriptions.has(span.description)
      ? span.description
      : undefined);
  span.data = getSafeSpanData(span.data);
  return span;
}

// Dashboard dump, then CLI-style extra scrub. Segment-split so "timeout" does
// not match "token". Nested secrets under boring keys can still leak.
const sensitiveDiagnosticKeySegments = new Set([
  "password",
  "passwd",
  "secret",
  "authorization",
  "cookie",
  "cookies",
  "token",
  "key",
  "dsn",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "connectionstring",
  "clientsecret",
  "privatekey",
  "setcookie",
  "bearer",
  "credential",
  "credentials",
]);

const maxDiagnosticDepth = 8;
const maxDiagnosticCollectionSize = 50;

function matchesSensitiveDiagnosticSegment(part: string): boolean {
  if (sensitiveDiagnosticKeySegments.has(part)) {
    return true;
  }
  // tokens / passwords / secrets / dsns / apiKeys — same as the singular forms
  // already in the set (credential/credentials were listed explicitly).
  if (part.length > 3 && part.endsWith("es") && sensitiveDiagnosticKeySegments.has(part.slice(0, -2))) {
    return true;
  }
  if (part.length > 2 && part.endsWith("s") && sensitiveDiagnosticKeySegments.has(part.slice(0, -1))) {
    return true;
  }
  return false;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  const compact = normalized.replaceAll("_", "");
  if (matchesSensitiveDiagnosticSegment(compact)) {
    return true;
  }
  return normalized.split("_").some((part) => part !== "" && matchesSensitiveDiagnosticSegment(part));
}

function scrubDiagnosticString(value: string): string {
  return value
    .replaceAll(
      /\b(sk_[A-Za-z0-9_-]+|pk_[A-Za-z0-9_-]+|pck_[A-Za-z0-9_-]+|stk_[A-Za-z0-9_-]+|ssk_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      "[redacted]",
    )
    // postgres://user:pass@host and the same userinfo shape on other URLs
    .replaceAll(/:\/\/[^/@\s]+:[^/@\s]+@/g, "://[redacted]@");
}

function scrubDiagnosticValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (key != null && isSensitiveDiagnosticKey(key) && value != null) {
    return "[redacted]";
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return scrubDiagnosticString(value);
  }
  if (typeof value === "bigint") {
    return scrubDiagnosticString(value.toString());
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return `[${typeof value}]`;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubDiagnosticString(value.message),
    };
  }
  if (typeof value !== "object") {
    return value;
  }
  if (depth >= maxDiagnosticDepth) {
    return "[truncated]";
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const entries = value.slice(0, maxDiagnosticCollectionSize).map((entry) => (
      scrubDiagnosticValue(entry, undefined, seen, depth + 1)
    ));
    if (value.length > maxDiagnosticCollectionSize) {
      entries.push("[truncated]");
    }
    return entries;
  }
  const keys = Object.keys(value);
  const scrubbed = new Map<string, unknown>();
  for (const nestedKey of keys.slice(0, maxDiagnosticCollectionSize)) {
    scrubbed.set(nestedKey, scrubDiagnosticValue(Reflect.get(value, nestedKey), nestedKey, seen, depth + 1));
  }
  if (keys.length > maxDiagnosticCollectionSize) {
    scrubbed.set("[truncated]", true);
  }
  return Object.fromEntries(scrubbed);
}

/**
 * Dashboard dump (cause, enumerable error props, nicify), then key-scrub.
 * nicify runs on already-scrubbed errorProps so the string dump does not
 * re-introduce redacted values.
 */
function getExceptionExtra(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {};
  }

  const errorProps = scrubDiagnosticValue({ ...error });
  return {
    cause: scrubDiagnosticValue(error.cause),
    errorProps,
    nicifiedError: nicify(errorProps, { maxDepth: 8 }),
  };
}

/**
 * Keep the minimum metadata needed to correlate a backend error while ensuring
 * request bodies, credentials, query values, customer identities, and SQL never
 * cross the Sentry boundary. Clears `extra` entirely — callers that need
 * diagnostics should go through prepareBackendSentryEvent, which rebuilds it.
 */
export function sanitizeBackendSentryEvent<T extends Event>(event: T): T {
  if (event.request != null) {
    event.request = {
      method: event.request.method,
    };
  }
  event.user = undefined;
  event.tags = undefined;
  event.extra = undefined;

  event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
    type: breadcrumb.type,
    level: breadcrumb.level,
    category: breadcrumb.category,
    timestamp: breadcrumb.timestamp,
  }));

  event.spans = event.spans?.map(sanitizeBackendSentrySpan);

  const traceContext = event.contexts?.trace;
  const requestContext = event.contexts?.["stack-request"];
  const requestId = requestContext?.requestId;
  const requestMethod = requestContext?.method;
  // `route` is the matched route pattern (e.g. `/api/latest/users/[user_id]`), never the
  // concrete path — same safety rationale as the http.route span attribute above.
  const requestRoute = requestContext?.route;
  const safeRequestDescription = getSafeRequestDescription(requestMethod, requestRoute);
  const safeTraceDescription = getSafeRequestDescription(
    traceContext?.data?.["http.request.method"],
    traceContext?.data?.["http.route"],
  );
  // Sentry retains request.method even when its Node HTTP finalizer discards a
  // custom route on Elysia middleware short-circuits. A fixed placeholder keeps
  // those transactions identifiable without admitting any part of the URL.
  const safeUnmatchedDescription = getSafeRequestDescription(event.request?.method, "<unmatched>");
  if (
    traceContext != null
    && safeRequestDescription == null
    && safeTraceDescription == null
    && safeUnmatchedDescription != null
    && typeof event.request?.method === "string"
  ) {
    traceContext.data = {
      ...(traceContext.data ?? {}),
      "http.request.method": event.request.method,
      "http.route": "<unmatched>",
    };
  }
  const safeTransactionDescription = safeRequestDescription
    ?? safeTraceDescription
    ?? safeUnmatchedDescription;
  if (safeTransactionDescription != null) {
    event.transaction = safeTransactionDescription;
  } else if (event.transaction != null) {
    event.transaction = "backend.request";
  }
  const safeRequestContext = typeof requestId === "string"
    ? {
      requestId,
      ...(typeof requestMethod === "string" ? { method: requestMethod } : {}),
      ...(typeof requestRoute === "string" ? { route: requestRoute } : {}),
    }
    : undefined;
  if (traceContext != null) {
    traceContext.data = getSafeSpanData(traceContext.data ?? {});
    traceContext.tags = undefined;
    traceContext.links = undefined;
  }
  event.contexts = traceContext == null && safeRequestContext == null
    ? undefined
    : {
      ...(traceContext == null ? {} : { trace: traceContext }),
      ...(safeRequestContext == null ? {} : { "stack-request": safeRequestContext }),
    };

  return event;
}

/**
 * beforeSend entrypoint: scrub request/span PII, then rebuild `extra` as the
 * dashboard dump plus captureError's `location`, then key-scrub that dump.
 */
export function prepareBackendSentryEvent<T extends Event>(event: T, hint?: EventHint): T {
  const location = typeof event.extra?.location === "string" ? event.extra.location : undefined;
  sanitizeBackendSentryEvent(event);

  const extra = {
    ...(location != null ? { location } : {}),
    ...getExceptionExtra(hint?.originalException),
  };
  event.extra = Object.keys(extra).length > 0 ? extra : undefined;
  return event;
}
