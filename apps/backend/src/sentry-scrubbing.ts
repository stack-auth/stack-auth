import { httpMethodNames } from "@/generated/route-modules";
import type { Event } from "@sentry/node";

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

/**
 * Keep the minimum metadata needed to correlate a backend error while ensuring
 * request bodies, credentials, query values, customer identities, and SQL never
 * cross the Sentry boundary.
 */
export function sanitizeBackendSentryEvent<T extends Event>(event: T): T {
  if (event.request != null) {
    event.request = {
      method: event.request.method,
    };
  }
  event.user = undefined;
  event.tags = undefined;

  const location = event.extra?.location;
  event.extra = typeof location === "string" ? { location } : undefined;

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
