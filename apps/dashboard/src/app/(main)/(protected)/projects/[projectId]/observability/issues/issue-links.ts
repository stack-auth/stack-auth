import { urlString } from "@hexclave/shared/dist/utils/urls";
import type { ObservabilityTimeRangeHours } from "../filters";

/**
 * Dashboard hrefs for the Issues surface.
 *
 * Kept apart from `issues-data.ts` so pages that only need to *link* at an
 * issue (Logs, the Traces rail, alert emails) don't pull in the
 * REST client and its response parsers.
 */

/**
 * The search param that carries the selected time window from the list to the
 * detail page (and through the detail page's own URL rewrites). Declared here
 * rather than in `issue-filters.ts` because the href builders below need it and
 * this module must stay dependency-light; `issue-filters.ts` imports these back
 * so the codec and the links can never disagree on the vocabulary.
 */
export const ISSUE_RANGE_PARAM_KEY = "range";
export const DEFAULT_ISSUE_RANGE_HOURS: ObservabilityTimeRangeHours = 24;

export function issuesListHref(projectId: string): string {
  return urlString`/projects/${projectId}/observability/issues`;
}

/** Deep-link to the authenticated project issue-alert rule surface. */
export function issueAlertRulesHref(projectId: string): string {
  return urlString`/projects/${projectId}/observability/issues/alerts`;
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

/**
 * `idOrShortId` is either the issue uuid or its per-branch short id.
 *
 * `rangeHours` carries the list's selected time window along so the detail
 * page's window-scoped counts match the numbers the reader just clicked on.
 * Omitted at the default so plain links (Logs, Traces, search) and
 * freshly-opened pages keep a clean URL — "no param" and "the default" must
 * never disagree, mirroring `serializeIssueFilters`.
 */
export function issueDetailHref(
  projectId: string,
  idOrShortId: string,
  options: { rangeHours?: ObservabilityTimeRangeHours } = {},
): string {
  const base = urlString`/projects/${projectId}/observability/issues/${idOrShortId}`;
  if (options.rangeHours == null || options.rangeHours === DEFAULT_ISSUE_RANGE_HOURS) return base;
  return `${base}?${ISSUE_RANGE_PARAM_KEY}=${encodeURIComponent(String(options.rangeHours))}`;
}

export { traceDetailHref, type TraceHighlight } from "../observability-links";
