import { urlString } from "@hexclave/shared/dist/utils/urls";

/**
 * Dashboard hrefs for the Issues surface.
 *
 * Kept apart from `issues-data.ts` so pages that only need to *link* at an
 * issue (Logs, the Traces rail, a future alert email preview) don't pull in the
 * REST client and its response parsers.
 */

export function issuesListHref(projectId: string): string {
  return urlString`/projects/${projectId}/observability/issues`;
}

/**
 * The list, pre-seeded with a free-text query across every status.
 *
 * `status=all` rather than the default `unresolved` on purpose: the caller
 * arrives from a specific error they already have in hand, and finding it
 * "missing" because someone resolved it last week is the worst possible
 * outcome of following this link.
 */
export function issueSearchHref(projectId: string, search: string): string {
  return `${issuesListHref(projectId)}?status=all&search=${encodeURIComponent(search)}`;
}

/** `idOrShortId` is either the issue uuid or its per-branch short id. */
export function issueDetailHref(projectId: string, idOrShortId: string): string {
  return urlString`/projects/${projectId}/observability/issues/${idOrShortId}`;
}

/** Deep-links the Traces page at a trace id (see its `?trace=` seeding). */
export function traceDetailHref(projectId: string, traceId: string): string {
  return `${urlString`/projects/${projectId}/observability/traces`}?trace=${encodeURIComponent(traceId)}`;
}
