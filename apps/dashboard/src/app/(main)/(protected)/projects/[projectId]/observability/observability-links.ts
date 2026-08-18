import { urlString } from "@hexclave/shared/dist/utils/urls";

/**
 * Dashboard hrefs for Observability and Analytics surfaces.
 *
 * Kept as plain URL builders so list pages, detail rails, and the events grid
 * can deep-link without importing page-client modules (and their data loaders).
 */

export type TraceHighlight = {
  traceId: string,
  spanId?: string | null,
  eventType?: string | null,
  eventAtMs?: number | null,
};

// Issue hrefs (issuesListHref, issueDetailHref, …) live in
// ./issues/issue-links, which re-exports this module's traceDetailHref for the
// Issues pages. They were briefly duplicated here as well; one home each keeps
// the URL logic from silently diverging.

export function tracesHref(projectId: string): string {
  return urlString`/projects/${projectId}/observability/traces`;
}

export function logsHref(projectId: string): string {
  return urlString`/projects/${projectId}/observability/logs`;
}

export function eventsHref(projectId: string): string {
  return urlString`/projects/${projectId}/analytics/events`;
}

export function sessionReplayHref(projectId: string, replayId: string, options?: { atMs?: number }): string {
  const path = urlString`/projects/${projectId}/session-replays/${replayId}`;
  if (options?.atMs == null) return path;
  return `${path}?at=${encodeURIComponent(String(options.atMs))}`;
}

/**
 * Deep-link the Traces page at a trace, optionally highlighting one span and
 * one event inside it. `event` + `at` are the event's type and epoch-ms — product
 * events have no durable id of their own, so that pair (plus the enclosing span
 * when present) is the shareable identity.
 *
 * The one-argument `traceId` form is kept so existing callers stay valid.
 */
export function traceDetailHref(projectId: string, traceIdOrHighlight: string | TraceHighlight): string {
  const highlight = typeof traceIdOrHighlight === "string"
    ? { traceId: traceIdOrHighlight }
    : traceIdOrHighlight;
  const params = new URLSearchParams();
  params.set("trace", highlight.traceId);
  if (highlight.spanId != null && highlight.spanId !== "") params.set("span", highlight.spanId);
  if (highlight.eventType != null && highlight.eventType !== "") params.set("event", highlight.eventType);
  if (highlight.eventAtMs != null) params.set("at", String(highlight.eventAtMs));
  return `${tracesHref(projectId)}?${params.toString()}`;
}
