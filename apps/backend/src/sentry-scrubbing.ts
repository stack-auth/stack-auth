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
  "pwd",
  "secret",
  "authorization",
  "cookie",
  "cookies",
  "token",
  "jwt",
  "otp",
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
  "signature",
]);

const maxDiagnosticDepth = 8;
const maxDiagnosticCollectionSize = 50;
// Sentry does not apply maxValueLength to extras we attach in beforeSend.
const maxDiagnosticStringLength = 5_000;
const maxDiagnosticNicifyLength = 20_000;
const maxDiagnosticPayloadBytes = 100_000;

type DiagnosticBudget = {
  used: number,
};

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

function scrubDiagnosticString(value: string, budget: DiagnosticBudget): string {
  if (budget.used >= maxDiagnosticPayloadBytes) {
    return "[truncated]";
  }
  let scrubbed = value
    .replaceAll(
      /\b(sk_[A-Za-z0-9_-]+|pk_[A-Za-z0-9_-]+|pck_[A-Za-z0-9_-]+|sak_[A-Za-z0-9_-]+|ssk_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      "[redacted]",
    )
    // Pass 1: user:password@, including passwords that contain @ or space.
    // Pass 2: user@ with no password. `[^\s/?#]*@` would also eat prose like
    // `https://api.example.com, page ops@company.com`.
    .replaceAll(/:\/\/[^\s/?#]*:[^/?#]*@/g, "://[redacted]@")
    .replaceAll(/:\/\/[^\s/?#@]*@/g, "://[redacted]@");
  if (scrubbed.length > maxDiagnosticStringLength) {
    scrubbed = `${scrubbed.slice(0, maxDiagnosticStringLength)}…`;
  }
  budget.used += scrubbed.length;
  if (budget.used > maxDiagnosticPayloadBytes) {
    return "[truncated]";
  }
  return scrubbed;
}

function takeIterable<T>(value: Iterable<T>, limit: number): T[] {
  const items: T[] = [];
  for (const item of value) {
    items.push(item);
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

function readOwnDataProperty(object: object, key: string): { kind: "missing" } | { kind: "accessor" } | { kind: "value", value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor == null) {
    return { kind: "missing" };
  }
  if (descriptor.get != null) {
    return { kind: "accessor" };
  }
  if (Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    return { kind: "value", value: descriptor.value };
  }
  return { kind: "missing" };
}

function scrubOwnEnumerableFields(
  value: object,
  seen: WeakSet<object>,
  depth: number,
  budget: DiagnosticBudget,
): unknown {
  if (depth >= maxDiagnosticDepth || budget.used >= maxDiagnosticPayloadBytes) {
    return "[truncated]";
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: unknown[] = [];
      const limit = Math.min(value.length, maxDiagnosticCollectionSize);
      for (let index = 0; index < limit; index++) {
        if (budget.used >= maxDiagnosticPayloadBytes) {
          entries.push("[truncated]");
          break;
        }
        entries.push(scrubDiagnosticValue(value[index], undefined, seen, depth + 1, budget));
      }
      if (value.length > maxDiagnosticCollectionSize && entries.at(-1) !== "[truncated]") {
        entries.push("[truncated]");
      }
      return entries;
    }
    const scrubbed = new Map<string, unknown>();
    let enumerableCount = 0;
    let truncated = false;
    for (const nestedKey in value) {
      if (!Object.prototype.hasOwnProperty.call(value, nestedKey)) {
        continue;
      }
      enumerableCount += 1;
      if (enumerableCount > maxDiagnosticCollectionSize || budget.used >= maxDiagnosticPayloadBytes) {
        truncated = true;
        break;
      }
      const own = readOwnDataProperty(value, nestedKey);
      if (own.kind === "accessor") {
        scrubbed.set(nestedKey, isSensitiveDiagnosticKey(nestedKey) ? "[redacted]" : "[accessor]");
        continue;
      }
      if (own.kind === "value") {
        scrubbed.set(nestedKey, scrubDiagnosticValue(own.value, nestedKey, seen, depth + 1, budget));
      }
    }
    if (truncated) {
      scrubbed.set("[truncated]", true);
    }
    return Object.fromEntries(scrubbed);
  } finally {
    // Path-local `seen`: diamonds (`{ a: shared, b: shared }`) must dump twice,
    // not mark the second edge `[circular]`. True cycles still hit `seen` on the
    // way down, before this unwind.
    seen.delete(value);
  }
}

function scrubDiagnosticValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
  budget: DiagnosticBudget = { used: 0 },
): unknown {
  if (key != null && isSensitiveDiagnosticKey(key) && value != null) {
    return "[redacted]";
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return scrubDiagnosticString(value, budget);
  }
  if (typeof value === "bigint") {
    return scrubDiagnosticString(value.toString(), budget);
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return `[${typeof value}]`;
  }
  if (value instanceof Error) {
    const name = readOwnDataProperty(value, "name");
    const message = readOwnDataProperty(value, "message");
    return {
      name: name.kind === "accessor" ? "[accessor]" : name.kind === "value" && typeof name.value === "string" ? name.value : value.constructor.name,
      message: message.kind === "accessor" ? "[accessor]" : message.kind === "value" && typeof message.value === "string" ? scrubDiagnosticString(message.value, budget) : "",
    };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[Invalid Date]" : scrubDiagnosticString(value.toISOString(), budget);
  }
  if (value instanceof URL) {
    return scrubDiagnosticString(value.href, budget);
  }
  if (value instanceof RegExp) {
    return scrubDiagnosticString(value.toString(), budget);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[bytes ${value.byteLength}]`;
  }
  if (typeof value !== "object") {
    return value;
  }
  // Map/Set don't enumerate entries via for-in. Mark the original in `seen`
  // before converting so a collection that contains itself stays `[circular]`.
  // Copy at most cap+1 entries so a huge collection cannot allocate unbounded
  // intermediates; the enumerable walk then applies the usual 50-item truncation.
  if (value instanceof Map || value instanceof Set) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    try {
      const converted = value instanceof Map
        ? Object.fromEntries(takeIterable(value.entries(), maxDiagnosticCollectionSize + 1).map(([mapKey, mapValue]) => [
          typeof mapKey === "string" ? mapKey : String(mapKey),
          mapValue,
        ]))
        : takeIterable(value, maxDiagnosticCollectionSize + 1);
      return scrubOwnEnumerableFields(converted, seen, depth, budget);
    } finally {
      seen.delete(value);
    }
  }
  return scrubOwnEnumerableFields(value, seen, depth, budget);
}

function capNicifiedError(value: string): string {
  if (value.length <= maxDiagnosticNicifyLength) {
    return value;
  }
  return `${value.slice(0, maxDiagnosticNicifyLength)}…`;
}

function extrasFromDumpedProps(errorProps: unknown): Record<string, unknown> {
  if (
    errorProps != null
    && typeof errorProps === "object"
    && !Array.isArray(errorProps)
    && Object.keys(errorProps).length === 0
  ) {
    return {};
  }
  return {
    errorProps,
    nicifiedError: capNicifiedError(nicify(errorProps, { maxDepth: maxDiagnosticDepth })),
  };
}

/**
 * Dashboard dump (cause, enumerable error props, nicify), then key-scrub.
 * Root errorProps walks enumerable own data (extraData) without spreading the
 * Error. Nested Error values stay name/message only. nicify runs on the
 * already-scrubbed tree so its cycle handling stays in the readable dump
 * without re-walking live getters.
 */
function getExceptionExtra(error: unknown): Record<string, unknown> {
  if (error === undefined) {
    return {};
  }
  const budget: DiagnosticBudget = { used: 0 };
  const seen = new WeakSet<object>();
  if (!(error instanceof Error)) {
    return extrasFromDumpedProps(scrubDiagnosticValue(error, undefined, seen, 0, budget));
  }

  const errorProps = scrubOwnEnumerableFields(error, seen, 0, budget);
  const causeProperty = readOwnDataProperty(error, "cause");
  const cause = causeProperty.kind === "accessor"
    ? "[accessor]"
    : causeProperty.kind === "value"
      ? scrubDiagnosticValue(causeProperty.value, undefined, seen, 0, budget)
      : undefined;
  return {
    ...(cause !== undefined ? { cause } : {}),
    ...extrasFromDumpedProps(errorProps),
  };
}

/**
 * Keep the minimum metadata needed to correlate a backend error while ensuring
 * request bodies, credentials, query values, customer identities, and SQL never
 * cross the Sentry boundary. Clears `extra` entirely — callers that need
 * diagnostics should go through prepareBackendSentryEvent, which rebuilds a
 * scrubbed dump. extraData on HexclaveAssertionError can still mention
 * identities if a caller put them there; this sanitizer only default-denies
 * the request/span/user envelope.
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
