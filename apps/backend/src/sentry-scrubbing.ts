import type { Event } from "@sentry/node";

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

type BackendSentrySpan = NonNullable<Event["spans"]>[number];

function getSafeSpanData(data: BackendSentrySpan["data"]): BackendSentrySpan["data"] {
  return Object.fromEntries(
    Object.entries(data).filter(([attributeName]) => safeSpanAttributeNames.has(attributeName)),
  );
}

export function sanitizeBackendSentrySpan(span: BackendSentrySpan): BackendSentrySpan {
  span.description = undefined;
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
  if (event.transaction != null) {
    event.transaction = "backend.request";
  }

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
  if (traceContext != null) {
    traceContext.data = getSafeSpanData(traceContext.data ?? {});
    traceContext.tags = undefined;
    traceContext.links = undefined;
  }
  event.contexts = traceContext == null ? undefined : { trace: traceContext };

  return event;
}
