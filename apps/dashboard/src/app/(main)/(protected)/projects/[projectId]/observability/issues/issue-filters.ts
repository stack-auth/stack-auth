import type { DataGridSortModel } from "@hexclave/dashboard-ui-components";
import {
  ALL_SERVICES_SELECT_VALUE,
  isObservabilityTimeRangeHours,
  type ObservabilityTimeRangeHours,
} from "../filters";
import {
  selectValueToServiceIdentity,
  serviceIdentityToSelectValue,
  type ServiceIdentity,
} from "../service-identity";
import {
  ISSUE_STATUSES, type IssueHandledFilter, type IssueListSortField,
  type IssueStatus,
} from "./issues-data";

/**
 * The Issues list's own URL state — everything that is not grid chrome.
 *
 * Grid chrome (widths, hidden columns, sort, quick search) belongs to
 * `useDataGridUrlState`, which writes via `history.replaceState`. This codec
 * therefore has to be written back the same way; mixing in `router.replace`
 * would rebuild the query string from Next's cached `useSearchParams`, which
 * has never seen the grid's params and would silently drop them on the next
 * filter change.
 */

export const ALL_STATUSES_FILTER_VALUE = "all";
export type IssueStatusFilter = IssueStatus | typeof ALL_STATUSES_FILTER_VALUE;

export const ISSUE_HANDLED_FILTERS: readonly IssueHandledFilter[] = ["all", "unhandled", "handled"];

export type IssueFilters = {
  hours: ObservabilityTimeRangeHours,
  status: IssueStatusFilter,
  service: ServiceIdentity | null,
  environment: string | null,
  handled: IssueHandledFilter,
  search: string,
};

export const DEFAULT_ISSUE_FILTERS: IssueFilters = {
  // 24h, not Logs' 720h. Logs is an archive you go digging in; Issues is a
  // triage queue, and a month-wide default buries today's regression under
  // everything that has ever gone wrong.
  hours: 24,
  status: "unresolved",
  service: null,
  environment: null,
  // Deliberately All. Defaulting to Unhandled hides handled crashes — the ones
  // a `try/catch` swallowed — which are frequently the more interesting half.
  handled: "all",
  search: "",
};

const PARAM_KEYS = {
  hours: "range",
  status: "status",
  service: "service",
  environment: "environment",
  handled: "handled",
  search: "search",
} as const;

/**
 * Every parse below treats the URL as untrusted input and falls back to the
 * default on anything it doesn't recognize, rather than throwing: a hand-edited
 * or stale bookmarked URL should open the default view, not a crashed page.
 * (Values that come from our own UI are validated at the point they're set.)
 */
export function parseIssueFilters(params: URLSearchParams): IssueFilters {
  const rawHours = Number(params.get(PARAM_KEYS.hours));
  const rawHandled = params.get(PARAM_KEYS.handled);
  const rawService = params.get(PARAM_KEYS.service);
  const rawEnvironment = params.get(PARAM_KEYS.environment);

  return {
    hours: isObservabilityTimeRangeHours(rawHours) ? rawHours : DEFAULT_ISSUE_FILTERS.hours,
    status: parseIssueStatusFilter(params.get(PARAM_KEYS.status)),
    service: rawService == null || rawService === ALL_SERVICES_SELECT_VALUE
      ? null
      : safeSelectValueToServiceIdentity(rawService),
    environment: rawEnvironment != null && rawEnvironment !== "" ? rawEnvironment : null,
    handled: ISSUE_HANDLED_FILTERS.find((candidate) => candidate === rawHandled)
      ?? DEFAULT_ISSUE_FILTERS.handled,
    search: params.get(PARAM_KEYS.search) ?? DEFAULT_ISSUE_FILTERS.search,
  };
}

export function parseIssueStatusFilter(raw: string | null): IssueStatusFilter {
  if (raw === ALL_STATUSES_FILTER_VALUE) return ALL_STATUSES_FILTER_VALUE;
  return ISSUE_STATUSES.find((candidate) => candidate === raw) ?? DEFAULT_ISSUE_FILTERS.status;
}

function safeSelectValueToServiceIdentity(value: string): ServiceIdentity | null {
  // Narrow, single-call catch — not a catch-all. `selectValueToServiceIdentity`
  // (and the `decodeURIComponent` inside it) throws on a malformed value, which
  // is the right contract for a dropdown, whose option list produced the value,
  // and the wrong one for a bookmarked URL. Unparseable becomes "no filter".
  try {
    return selectValueToServiceIdentity(value);
  } catch {
    return null;
  }
}

/**
 * Writes the non-default filters into `params`, deleting the rest, and returns
 * the same object. Defaults are omitted so a freshly-opened page has a clean
 * URL and so "no param" and "the default" can never disagree.
 */
export function serializeIssueFilters(filters: IssueFilters, params: URLSearchParams): URLSearchParams {
  const setOrDelete = (key: string, value: string | null) => {
    if (value == null) params.delete(key);
    else params.set(key, value);
  };
  setOrDelete(PARAM_KEYS.hours, filters.hours === DEFAULT_ISSUE_FILTERS.hours ? null : String(filters.hours));
  setOrDelete(PARAM_KEYS.status, filters.status === DEFAULT_ISSUE_FILTERS.status ? null : filters.status);
  setOrDelete(PARAM_KEYS.service, filters.service == null ? null : serviceIdentityToSelectValue(filters.service));
  setOrDelete(PARAM_KEYS.environment, filters.environment);
  setOrDelete(PARAM_KEYS.handled, filters.handled === DEFAULT_ISSUE_FILTERS.handled ? null : filters.handled);
  setOrDelete(PARAM_KEYS.search, filters.search === "" ? null : filters.search);
  return params;
}

export function issueFiltersAreDefault(filters: IssueFilters): boolean {
  return serializeIssueFilters(filters, new URLSearchParams()).toString() === "";
}

// ─── Sorting ─────────────────────────────────────────────────────────

/**
 * Only four columns are sortable, and the mapping is explicit rather than
 * derived from the column id: "Issue" and "Status" live in Postgres while
 * "Events" and "Users" are window-scoped ClickHouse aggregates, so a generic
 * `ORDER BY <columnId>` would be meaningless for half the grid. Those columns
 * are declared `sortable: false` rather than sortable-and-wrong.
 */
const SORTABLE_COLUMN_FIELDS = new Map<string, IssueListSortField>([
  ["events", "events"],
  ["users", "users"],
  ["lastSeen", "last_seen"],
  ["firstSeen", "first_seen"],
]);

export const DEFAULT_ISSUE_SORT: { field: IssueListSortField, direction: "asc" | "desc" } = {
  field: "last_seen",
  direction: "desc",
};

export function isSortableIssueColumn(columnId: string): boolean {
  return SORTABLE_COLUMN_FIELDS.has(columnId);
}

/**
 * The grid's sort model is also URL-restorable, so an unknown column id here is
 * untrusted input rather than a programming error — it falls back to the
 * default instead of throwing, same rule as the filters above.
 */
export function resolveIssueSort(sorting: DataGridSortModel): { field: IssueListSortField, direction: "asc" | "desc" } {
  if (sorting.length === 0) return DEFAULT_ISSUE_SORT;
  const first = sorting[0];
  const field = SORTABLE_COLUMN_FIELDS.get(first.columnId);
  if (field == null) return DEFAULT_ISSUE_SORT;
  return { field, direction: first.direction };
}
