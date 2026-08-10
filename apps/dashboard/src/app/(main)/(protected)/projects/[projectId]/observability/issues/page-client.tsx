"use client";

import { DesignAlert, DesignButton, DesignCategoryTabs, DesignInput, DesignPillToggle, DesignSelectorDropdown } from "@/components/design-components";
import { TooltipProvider, Typography } from "@/components/ui";
import { useRouter } from "@/components/router";
import { ArrowClockwiseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  DataGrid,
  DataGridToolbar,
  useDataGridUrlState,
  useDataSource,
  type DataGridDataSource,
  type DataGridToolbarContext,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { AnalyticsEventLimitBanner } from "../../analytics/shared";
import { getBucketGranularity } from "../bucket-granularity";
import {
  ALL_SERVICES_SELECT_VALUE,
  OBSERVABILITY_TIME_RANGE_OPTIONS,
  parseObservabilityTimeRangeId,
} from "../filters";
import {
  serviceIdentityLabel,
  serviceIdentityToSelectValue,
  selectValueToServiceIdentity,
} from "../service-identity";
import {
  buildIssueColumns,
  ISSUE_COLUMN_IDS,
  ISSUE_COLUMNS_HIDDEN_BY_DEFAULT,
  type IssueCellContext,
} from "./issue-columns";
import { issueDetailHref } from "./issue-links";
import {
  ALL_STATUSES_FILTER_VALUE,
  DEFAULT_ISSUE_FILTERS,
  DEFAULT_ISSUE_SORT,
  ISSUE_HANDLED_FILTERS,
  issueFiltersAreDefault,
  parseIssueFilters,
  parseIssueStatusFilter,
  resolveIssueSort,
  serializeIssueFilters,
  type IssueFilters,
} from "./issue-filters";
import {
  applyOptimisticStatus,
  clearOptimisticStatus,
  NO_ISSUE_STATUS_OVERRIDES,
  reconcileIssueStatusOverrides,
  type IssueStatusOverrides,
} from "./issue-status";
import {
  fetchIssueList,
  updateIssueStatus,
  type IssueListItem,
  type IssueStatus,
  type IssueStatusCounts,
} from "./issues-data";
import { useIssueFacets, useIssueSparklines } from "./use-issue-data";

const SEARCH_DEBOUNCE_MS = 300;

const ALL_ENVIRONMENTS_SELECT_VALUE = "all";

const HANDLED_FILTER_LABELS = new Map([
  ["all", "Handled & unhandled"],
  ["unhandled", "Unhandled only"],
  ["handled", "Handled only"],
]);

function handledFilterLabel(value: string): string {
  const label = HANDLED_FILTER_LABELS.get(value);
  if (label == null) throw new Error(`Missing label for handled filter: ${value}`);
  return label;
}

function readFiltersFromLocation(): IssueFilters {
  if (typeof window === "undefined") return DEFAULT_ISSUE_FILTERS;
  return parseIssueFilters(new URLSearchParams(window.location.search));
}

/**
 * Captured once at module scope on purpose: `useDataGridUrlState` snapshots
 * `initial` on first render, and recomputing this per render would mean the
 * user's own visibility choices are the ones being compared against a moving
 * baseline when the URL is serialized.
 */
const INITIAL_ISSUE_COLUMN_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  ISSUE_COLUMN_IDS.map((id) => [id, !ISSUE_COLUMNS_HIDDEN_BY_DEFAULT.includes(id)]),
);

function IssuesEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
      <Typography className="font-medium">
        {filtered ? "No matching issues" : "No issues yet"}
      </Typography>
      <Typography variant="secondary" className="max-w-lg text-sm">
        {filtered
          ? "Nothing matches these filters in the selected range. Clear a filter, widen the range, or switch to another status."
          : <>
            Errors are captured automatically once your app uses the SDK — uncaught exceptions,
            unhandled rejections, and server request errors are grouped here as they arrive.
          </>}
      </Typography>
    </div>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const router = useRouter();
  const projectId = adminApp.projectId;

  const [filters, setFilters] = useState<IssueFilters>(readFiltersFromLocation);
  const [debouncedSearch] = useDebounce(filters.search.trim(), SEARCH_DEBOUNCE_MS);
  const [counts, setCounts] = useState<IssueStatusCounts | null>(null);
  const [approximate, setApproximate] = useState(false);
  const [overrides, setOverrides] = useState<IssueStatusOverrides>(NO_ISSUE_STATUS_OVERRIDES);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Single "now" for every relative timestamp in the table, refreshed on reload
  // so the column doesn't quietly drift while the page sits open.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  // Filters are written back with `history.replaceState`, NOT `router.replace`:
  // `useDataGridUrlState` writes the grid's own params the same way, and Next's
  // router would rebuild the query string from its cached `useSearchParams`,
  // which has never seen those params — silently dropping the user's column and
  // sort choices on the next filter change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = serializeIssueFilters(filters, new URLSearchParams(window.location.search));
    const next = params.toString();
    if (next === window.location.search.replace(/^\?/, "")) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${next === "" ? "" : `?${next}`}${window.location.hash}`,
    );
  }, [filters]);

  const facetsState = useIssueFacets(adminApp, filters.hours);

  const dataSource = useMemo<DataGridDataSource<IssueListItem>>(() => {
    return async function* (params) {
      const sort = resolveIssueSort(params.sorting);
      const response = await fetchIssueList(adminApp, {
        hours: filters.hours,
        status: filters.status,
        service: filters.service,
        environment: filters.environment,
        handled: filters.handled,
        search: debouncedSearch,
        sort: sort.field,
        sortDir: sort.direction,
        cursor: typeof params.cursor === "string" ? params.cursor : null,
        limit: params.pagination.pageSize,
      });
      setCounts(response.counts);
      setApproximate(response.approximate);
      yield {
        rows: response.items,
        nextCursor: response.cursor,
        hasMore: response.cursor != null,
      };
    };
  }, [
    adminApp,
    filters.hours,
    filters.status,
    filters.service,
    filters.environment,
    filters.handled,
    debouncedSearch,
  ]);

  const changeStatus = useCallback(async (issue: IssueListItem, status: IssueStatus) => {
    setStatusError(null);
    setOverrides(applyOptimisticStatus(overridesRef.current, issue.id, status, issue.updated_at_millis));
    try {
      await updateIssueStatus(adminApp, issue.id, status);
      // Deliberately no refetch: under the default Unresolved filter a refetch
      // would yank the row out from under the cursor mid-scan. The override is
      // versioned, so the next natural refresh reconciles it.
    } catch (error) {
      // Narrow catch around one call: revert and surface. Never swallowed, and
      // never a toast — a failed state change must stay on screen.
      setOverrides(clearOptimisticStatus(overridesRef.current, issue.id));
      setStatusError(error instanceof Error ? error.message : String(error));
    }
  }, [adminApp]);

  const bucketLabel = getBucketGranularity(filters.hours).label;

  // Built before `useDataSource` because the hook needs them; the cell context
  // is rebuilt whenever anything a cell reads changes, which is what makes the
  // sparklines and optimistic states appear without touching grid state.
  const [gridRows, setGridRows] = useState<readonly IssueListItem[]>([]);
  const sparklines = useIssueSparklines(adminApp, filters.hours, gridRows);

  const cellContext = useMemo<IssueCellContext>(() => ({
    projectId,
    nowMs,
    overrides,
    sparklinesByHash: sparklines.byHash,
    bucketLabel,
    onChangeStatus: changeStatus,
  }), [projectId, nowMs, overrides, sparklines.byHash, bucketLabel, changeStatus]);

  const columns = useMemo(() => buildIssueColumns(cellContext), [cellContext]);

  const [gridState, setGridState] = useDataGridUrlState(columns, {
    paramPrefix: "issues",
    initial: {
      sorting: [{ columnId: "lastSeen", direction: DEFAULT_ISSUE_SORT.direction }],
      columnVisibility: INITIAL_ISSUE_COLUMN_VISIBILITY,
    },
  });

  const getRowId = useCallback((row: IssueListItem) => row.id, []);

  const gridData = useDataSource<IssueListItem>({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: "",
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  // Mirror the loaded rows into state so the sparkline loader can key off them.
  // `useDataSource` owns the rows; this is a read-only projection.
  useEffect(() => {
    setGridRows(gridData.rows);
  }, [gridData.rows]);

  // Drop optimistic overrides the server has already moved past, so a later
  // automatic regression of the same issue is not masked by a stale "Resolved".
  useEffect(() => {
    const reconciled = reconcileIssueStatusOverrides(overridesRef.current, gridData.rows);
    if (reconciled !== overridesRef.current) setOverrides(reconciled);
  }, [gridData.rows]);

  const reload = useCallback(() => {
    setNowMs(Date.now());
    gridData.reload();
  }, [gridData]);

  const statusTabs = useMemo(() => [
    { id: "unresolved", label: "Unresolved", count: counts?.unresolved },
    { id: "resolved", label: "Resolved", count: counts?.resolved },
    { id: "ignored", label: "Ignored", count: counts?.ignored },
    {
      id: ALL_STATUSES_FILTER_VALUE,
      label: "All",
      count: counts == null ? undefined : counts.unresolved + counts.resolved + counts.ignored,
    },
  ], [counts]);

  const renderToolbar = useCallback((ctx: DataGridToolbarContext<IssueListItem>) => (
    <DataGridToolbar
      ctx={ctx}
      hideQuickSearch
      extraLeading={
        <DesignInput
          size="sm"
          leadingIcon={<MagnifyingGlassIcon />}
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          placeholder="Search type, message, culprit…"
          className="w-full sm:w-64"
          aria-label="Search issues"
        />
      }
      extra={
        <>
          <DesignSelectorDropdown
            value={serviceIdentityToSelectValue(filters.service)}
            onValueChange={(value) => setFilters((current) => ({
              ...current,
              service: selectValueToServiceIdentity(value),
            }))}
            options={[
              { value: ALL_SERVICES_SELECT_VALUE, label: "All services" },
              ...facetsState.facets.services.map((identity) => ({
                value: serviceIdentityToSelectValue(identity),
                label: serviceIdentityLabel(identity),
              })),
            ]}
            size="sm"
            disabled={facetsState.loading}
          />
          <DesignSelectorDropdown
            value={filters.environment ?? ALL_ENVIRONMENTS_SELECT_VALUE}
            onValueChange={(value) => setFilters((current) => ({
              ...current,
              environment: value === ALL_ENVIRONMENTS_SELECT_VALUE ? null : value,
            }))}
            options={[
              { value: ALL_ENVIRONMENTS_SELECT_VALUE, label: "All environments" },
              ...facetsState.facets.environments.map((environment) => ({
                value: environment,
                label: environment,
              })),
            ]}
            size="sm"
            disabled={facetsState.loading}
          />
          <DesignSelectorDropdown
            value={filters.handled}
            onValueChange={(value) => {
              const handled = ISSUE_HANDLED_FILTERS.find((candidate) => candidate === value);
              if (handled == null) throw new Error(`Unknown handled filter: ${value}`);
              setFilters((current) => ({ ...current, handled }));
            }}
            options={ISSUE_HANDLED_FILTERS.map((value) => ({ value, label: handledFilterLabel(value) }))}
            size="sm"
          />
        </>
      }
      extraActions={
        <DesignButton
          variant="ghost"
          size="sm"
          loading={gridData.isRefetching}
          onClick={reload}
          className="gap-1.5"
        >
          <ArrowClockwiseIcon className="h-3.5 w-3.5" />
          Refresh
        </DesignButton>
      }
    />
  ), [filters.search, filters.service, filters.environment, filters.handled, facetsState.facets, facetsState.loading, gridData.isRefetching, reload]);

  const filtersActive = !issueFiltersAreDefault(filters);

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout fillWidth noPadding containedHeight>
        {/* The column headers and the First-seen cell explain which store each
            number came from via SimpleTooltip, which needs a provider in scope. */}
        <TooltipProvider>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0">
              <AnalyticsEventLimitBanner />
            </div>

            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-3 py-3">
              <div>
                <Typography type="h2" className="text-xl font-semibold tracking-tight">
                  Issues
                </Typography>
                <Typography variant="secondary" className="mt-0.5 text-sm">
                  Errors from your app, grouped into issues you can resolve, ignore, and watch for regressions.
                </Typography>
              </div>
              <DesignPillToggle
                selected={String(filters.hours)}
                onSelect={(id) => setFilters((current) => ({
                  ...current,
                  hours: parseObservabilityTimeRangeId(id),
                }))}
                options={OBSERVABILITY_TIME_RANGE_OPTIONS}
                size="sm"
                glassmorphic={false}
              />
            </div>

            <div className="shrink-0 px-3">
              <DesignCategoryTabs
                categories={statusTabs}
                selectedCategory={filters.status}
                onSelect={(id) => setFilters((current) => ({ ...current, status: parseIssueStatusFilter(id) }))}
                size="sm"
                glassmorphic={false}
              />
            </div>

            {statusError != null && (
              <div className="shrink-0 px-3 pt-3">
                <DesignAlert
                  variant="error"
                  title="Couldn't update that issue"
                  description={statusError}
                />
              </div>
            )}

            {gridData.error != null && (
              <div className="shrink-0 px-3 pt-3">
                <DesignAlert variant="error" title="Couldn't load issues" description={gridData.error.message}>
                  <DesignButton variant="secondary" size="sm" className="mt-3" onClick={reload}>
                    Retry
                  </DesignButton>
                </DesignAlert>
              </div>
            )}

            {facetsState.error != null && (
              <div className="shrink-0 px-3 pt-3">
                <DesignAlert
                  variant="warning"
                  title="Filter options couldn't be loaded"
                  description="The service and environment dropdowns are empty. The issue list itself is unaffected."
                />
              </div>
            )}

            {sparklines.error != null && (
              <div className="shrink-0 px-3 pt-3">
                <DesignAlert variant="warning" title="Occurrence graphs couldn't be loaded" description={sparklines.error.message}>
                  <DesignButton variant="secondary" size="sm" className="mt-3" onClick={sparklines.retry}>
                    Retry graphs
                  </DesignButton>
                </DesignAlert>
              </div>
            )}

            {approximate && (
              <div className="shrink-0 px-3 pt-3">
                <DesignAlert
                  variant="info"
                  title="Ranking is approximate"
                  description="There are more matching issues than can be ranked by window activity at once, so this ordering covers a capped candidate set. Narrow the filters for an exact ranking."
                />
              </div>
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-3">
              <DataGrid<IssueListItem>
                columns={columns}
                rows={gridData.rows}
                getRowId={getRowId}
                isLoading={gridData.isLoading}
                isRefetching={gridData.isRefetching}
                isLoadingMore={gridData.isLoadingMore}
                hasMore={gridData.hasMore}
                onLoadMore={gridData.loadMore}
                state={gridState}
                onChange={setGridState}
                paginationMode="infinite"
                selectionMode="none"
                rowHeight={56}
                fillHeight
                stickyTop={0}
                horizontalScrollbarPosition="top"
                toolbar={renderToolbar}
                footer={false}
                exportFilename="issues-export"
                onRowClick={(row) => router.push(issueDetailHref(projectId, row.id))}
                emptyState={<IssuesEmptyState filtered={filtersActive} />}
              />
            </div>
          </div>
        </TooltipProvider>
      </PageLayout>
    </AppEnabledGuard>
  );
}
