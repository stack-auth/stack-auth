"use client";

import { DesignAlert, DesignButton, DesignInput, DesignPillToggle, DesignSelectorDropdown } from "@/components/design-components";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { ArrowClockwiseIcon, ChartLineIcon, CheckIcon, CopyIcon, LinkSimpleIcon, SpinnerGapIcon, StackIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { StickyPageHeader } from "../../sticky-page-header";
import { useAdminApp } from "../../use-admin-app";
import {
  AnalyticsEventLimitBanner,
  ErrorDisplay,
  RowDetailDialog,
  isDateValue,
  parseClickHouseDate,
  type RowData,
} from "../../analytics/shared";
import { SpanTreeList } from "./span-tree";
import {
  buildTraces,
  selectPrimaryTrace,
  traceContainsSpanId,
  type EventInput,
  type SpanInput,
  type Trace,
} from "./trace-utils";
import { TraceVolumeChart } from "./trace-volume-chart";
import {
  getTraceVolumeQuery,
  parseTraceVolumeRows,
  type TraceTimeRangeHours,
  type TraceVolumeBucket,
} from "./trace-volume";
import { TraceWaterfall } from "./waterfall";
import {
  selectValueToServiceIdentity,
  serviceIdentitiesFromTraceRow,
  serviceIdentityEquals,
  serviceIdentityLabel,
  serviceIdentityToSelectValue,
  parseServiceIdentityRow,
  type ServiceIdentity,
} from "../service-identity";
import { ALL_SERVICES_SELECT_VALUE, OBSERVABILITY_TIME_RANGE_OPTIONS, parseObservabilityTimeRangeId, queryObservability, readLocationSearch, replaceLocationSearch, useServiceIdentityLoader } from "../filters";
import { tryParseJson } from "../format";
import { TelemetryRowLinks } from "../telemetry-row-links";
import {
  DEFAULT_TRACE_PAGE_URL_STATE,
  parseTracePageUrlState,
  serializeTracePageUrlState,
  type TracePageUrlState,
} from "./trace-url-state";

const TRACE_SPAN_STRUCTURE_SELECT_SQL = `
SELECT
  s.trace_id,
  s.span_id,
  s.span_type,
  s.started_at,
  s.ended_at,
  s.parent_span_id,
  s.status_code,
  s.scope_name,
  -- Needed by traceSignalSpanIds to tell spans the customer's own code authored
  -- from auto-instrumented library/framework noise. Both arrive through the SDK;
  -- scope_name is the instrumentation marker.
  s.producer
FROM default.spans AS s
`;

const ROOT_PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;

export const TRACE_SERVICES_QUERY = `
SELECT service_namespace, service_name
FROM default.trace_services
WHERE service_name != ''
GROUP BY service_namespace, service_name
ORDER BY service_namespace ASC, service_name ASC
LIMIT 500
`;

export type TraceRootCursor = {
  activityMs: number,
  id: string,
};

export function getRecentTraceRootsQuery(
  cursor: TraceRootCursor | null,
  service: ServiceIdentity | null = null,
  search = "",
): {
  query: string,
  params: Record<string, string | number>,
} {
  const serviceCondition = service == null ? "" : `
    AND r.trace_id IN (
      SELECT trace_id
      FROM default.trace_services
      WHERE coalesce(service_namespace, '') = {serviceNamespace:String}
        AND service_name = {serviceName:String}
    )`;
  const searchCondition = search === "" ? "" : `
    AND (
      positionCaseInsensitiveUTF8(r.span_type, {search:String}) > 0
      OR positionCaseInsensitiveUTF8(JSONExtractString(r.data, 'name'), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(r.trace_id, {search:String}) > 0
      OR positionCaseInsensitiveUTF8(r.span_id, {search:String}) > 0
      OR arrayExists(service -> positionCaseInsensitiveUTF8(service.1, {search:String}) > 0, ts.services)
      OR arrayExists(service -> positionCaseInsensitiveUTF8(service.2, {search:String}) > 0, ts.services)
      OR positionCaseInsensitiveUTF8(ifNull(r.service_version, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(r.deployment_environment_name, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(r.user_id, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(r.refresh_token_id, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(r.session_replay_id, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(r.session_replay_segment_id, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(u.display_name, ''), {search:String}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(u.primary_email, ''), {search:String}) > 0
    )`;
  const cursorCondition = cursor == null ? "" : `
    AND (
      r.created_at < fromUnixTimestamp64Milli({cursorActivityMs:Int64})
      OR (r.created_at = fromUnixTimestamp64Milli({cursorActivityMs:Int64}) AND r.span_id < {cursorId:String})
    )`;
  return {
    query: `
SELECT
  r.trace_id AS trace_id,
  r.span_id,
  r.span_type,
  r.started_at,
  r.ended_at,
  r.created_at AS root_activity_at,
  r.status_code,
  r.scope_name,
  r.data,
  -- trace_roots only ever holds spans with a NULL parent, so the column is not
  -- stored; synthesizing it keeps these rows parseable by the same row parser
  -- the waterfall's span rows use.
  CAST(NULL, 'Nullable(String)') AS parent_span_id,
  u.display_name AS user_display_name,
  u.primary_email AS user_primary_email,
  u.profile_image_url AS user_profile_image_url,
  -- How many other root activities happened on this page view. Only ever
  -- non-zero for a $page-view row, because a page view is the only root that
  -- other roots point at; drives the expand affordance in the list.
  coalesce(child.child_count, 0) AS child_count,
  arrayMap(service -> service.1, ts.services) AS trace_service_namespaces,
  arrayMap(service -> service.2, ts.services) AS trace_service_names
FROM default.trace_roots AS r
LEFT JOIN default.users AS u ON toString(u.id) = r.user_id
LEFT JOIN (
  SELECT page_view_span_id, count() AS child_count
  FROM default.trace_roots
  WHERE created_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
    AND page_view_span_id IS NOT NULL
  GROUP BY page_view_span_id
) AS child ON child.page_view_span_id = r.span_id
LEFT JOIN (
  SELECT
    trace_id,
    arraySort(groupUniqArray(tuple(coalesce(service_namespace, ''), service_name))) AS services
  FROM default.trace_services
  WHERE service_name != ''
  GROUP BY trace_id
) AS ts ON ts.trace_id = r.trace_id
WHERE r.created_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
  -- Top level only. A root that names a page view is shown nested under it
  -- instead (see getPageViewChildrenQuery); without this the list repeats every
  -- request a page made as its own sibling row, which is ~15 extra rows per
  -- page visit on a browser-heavy project.
  AND r.page_view_span_id IS NULL
  ${serviceCondition}${searchCondition}${cursorCondition}
ORDER BY r.created_at DESC, r.span_id DESC
LIMIT ${ROOT_PAGE_SIZE}
`,
    params: {
      ...(cursor == null ? {} : { cursorActivityMs: cursor.activityMs, cursorId: cursor.id }),
      ...(service == null ? {} : {
        serviceNamespace: service.namespace,
        serviceName: service.name,
      }),
      ...(search === "" ? {} : { search }),
    },
  };
}

export const PAGE_VIEW_CHILDREN_CAP = 200;

export function getPageViewChildrenQuery(pageViewSpanId: string): {
  query: string,
  params: Record<string, string | number>,
} {
  return {
    query: `
SELECT
  r.trace_id AS trace_id,
  r.span_id,
  r.span_type,
  r.started_at,
  r.ended_at,
  r.status_code,
  r.scope_name,
  r.data,
  CAST(NULL, 'Nullable(String)') AS parent_span_id,
  u.display_name AS user_display_name,
  u.primary_email AS user_primary_email,
  u.profile_image_url AS user_profile_image_url,
  0 AS child_count,
  arrayMap(service -> service.1, ts.services) AS trace_service_namespaces,
  arrayMap(service -> service.2, ts.services) AS trace_service_names
FROM default.trace_roots AS r
LEFT JOIN default.users AS u ON toString(u.id) = r.user_id
LEFT JOIN (
  SELECT
    trace_id,
    arraySort(groupUniqArray(tuple(coalesce(service_namespace, ''), service_name))) AS services
  FROM default.trace_services
  WHERE service_name != ''
  GROUP BY trace_id
) AS ts ON ts.trace_id = r.trace_id
WHERE r.page_view_span_id = {pageViewSpanId:String}
ORDER BY r.started_at ASC, r.span_id ASC
LIMIT ${PAGE_VIEW_CHILDREN_CAP}
`,
    params: { pageViewSpanId },
  };
}

export function getSelectedTraceSpanQuery(traceId: string, focusSpanId: string | null = null): {
  query: string,
  params: Record<string, string | number>,
} {
  return {
    query: `
${TRACE_SPAN_STRUCTURE_SELECT_SQL}
WHERE s.trace_id = {traceId:String}
-- Oldest-first keeps the root and beginning of a pathological trace. When a
-- span-link navigation names a target, rank that exact span first so the
-- 10,000-row safety cap cannot turn a retained target into a false "missing"
-- result. The remaining 9,999 rows still begin at the physical trace root.
ORDER BY ${focusSpanId === null ? "s.started_at ASC" : "s.span_id = {focusSpanId:String} DESC, s.started_at ASC"}
LIMIT 10000
`,
    params: { traceId, ...focusSpanId === null ? {} : { focusSpanId } },
  };
}

export const TRACE_SPANS_CAP = 10000;
export const SPAN_LINKS_CAP = 1000;

export function getSelectedTraceLinksQuery(traceId: string): {
  query: string,
  params: Record<string, string>,
} {
  return {
    query: `
SELECT
  trace_id,
  owner_span_id,
  linked_trace_id,
  linked_span_id,
  linked_project_id,
  linked_branch_id,
  linked_project_id = project_id AND linked_branch_id = branch_id AS target_is_same_scope
FROM default.span_links
WHERE trace_id = {traceId:String}
ORDER BY owner_span_id ASC, linked_trace_id ASC, linked_span_id ASC
LIMIT ${SPAN_LINKS_CAP + 1}
`,
    params: { traceId },
  };
}

export const SPAN_DETAIL_COLUMNS: readonly string[] = [
  "span_type",
  "started_at",
  "ended_at",
  "status_code",
  "status_message",
  "deployment_environment_name",
  "data",
  "user_id",
  "team_id",
  "refresh_token_id",
  "session_replay_id",
  "session_replay_segment_id",
  "trace_id",
  "span_id",
  "parent_span_id",
  "page_view_span_id",
  "kind",
  "scope_name",
  "scope_version",
  "service_namespace",
  "service_name",
  "service_version",
  "service_instance_id",
  "resource_attributes",
  "producer",
  "created_at",
];

export const SPAN_TECHNICAL_DETAIL_COLUMNS: readonly string[] = [
  "trace_id",
  "span_id",
  "parent_span_id",
  "page_view_span_id",
  "kind",
  "scope_name",
  "scope_version",
  "service_namespace",
  "service_name",
  "service_version",
  "service_instance_id",
  "resource_attributes",
  "producer",
  "created_at",
  "user_display_name",
  "user_primary_email",
  "user_profile_image_url",
];

export function getSpanDetailQuery(traceId: string, spanId: string): {
  query: string,
  params: Record<string, string>,
} {
  return {
    query: `
SELECT ${SPAN_DETAIL_COLUMNS.join(", ")}
FROM default.spans
WHERE trace_id = {traceId:String}
  AND span_id = {spanId:String}
LIMIT 1
`,
    params: { traceId, spanId },
  };
}

export const TRACE_EVENT_WINDOW_SLACK_MS = 15 * 60 * 1000;

export function getSelectedTraceEventQuery(
  traceId: string,
  focusEventAtMs: number | null,
  window: { startMs: number, endMs: number },
): {
  query: string,
  params: Record<string, string | number>,
} {
  return {
    query: `
WITH correlated AS (
  SELECT event_type, event_at, data, CAST('' AS String) AS body, level,
         CAST(0 AS UInt8) AS severity_number, CAST('' AS String) AS severity_text,
         user_id, trace_id, span_id, page_view_span_id,
         refresh_token_id, session_replay_id, session_replay_segment_id
  FROM default.events
  UNION ALL
  SELECT event_type, event_at, data, body, level, severity_number, severity_text,
         user_id, trace_id, span_id, page_view_span_id,
         refresh_token_id, session_replay_id, session_replay_segment_id
  FROM default.logs
  UNION ALL
  SELECT event_type, event_at, data, body, level, severity_number, severity_text,
         user_id, trace_id, span_id, page_view_span_id,
         refresh_token_id, session_replay_id, session_replay_segment_id
  FROM default.errors
  UNION ALL
  SELECT event_type, event_at, data, CAST('' AS String) AS body, level,
         CAST(0 AS UInt8) AS severity_number, CAST('' AS String) AS severity_text,
         user_id, trace_id, span_id, page_view_span_id,
         refresh_token_id, session_replay_id, session_replay_segment_id
  FROM default.span_events
)
SELECT event_type, event_at, data, body, level, severity_number, severity_text,
       user_id, trace_id, span_id, page_view_span_id,
       refresh_token_id, session_replay_id, session_replay_segment_id
FROM correlated
WHERE trace_id = {traceId:String}
  AND event_at >= fromUnixTimestamp64Milli({eventWindowStartMs:Int64})
  AND event_at <= fromUnixTimestamp64Milli({eventWindowEndMs:Int64})
ORDER BY ${focusEventAtMs == null ? "event_at ASC" : "abs(toUnixTimestamp64Milli(event_at) - {focusEventAtMs:Int64}) ASC, event_at ASC"}
LIMIT 5000
`,
    params: {
      traceId,
      eventWindowStartMs: window.startMs,
      eventWindowEndMs: window.endMs,
      ...focusEventAtMs == null ? {} : { focusEventAtMs },
    },
  };
}

const CARD_CLASSES = "rounded-2xl border border-black/[0.06] bg-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-zinc-900/90";

function parseSpanRow(row: Record<string, unknown>): SpanInput | null {
  const traceId = row.trace_id;
  const id = row.span_id;
  const spanType = row.span_type;
  const startedAt = row.started_at;
  if (typeof traceId !== "string" || typeof id !== "string" || typeof spanType !== "string" || !isDateValue(startedAt)) return null;
  const endedAt = row.ended_at;
  return {
    traceId,
    id,
    spanType,
    startMs: parseClickHouseDate(startedAt).getTime(),
    endMs: isDateValue(endedAt) ? parseClickHouseDate(endedAt).getTime() : null,
    parentSpanId: typeof row.parent_span_id === "string" && row.parent_span_id !== "" ? row.parent_span_id : null,
    raw: {
      ...row,
      data: tryParseJson(row.data),
      resource_attributes: tryParseJson(row.resource_attributes),
    },
  };
}

export function parseEventRow(row: Record<string, unknown>): EventInput | null {
  const eventType = row.event_type;
  const eventAt = row.event_at;
  if (typeof eventType !== "string" || !isDateValue(eventAt)) return null;
  const traceId = typeof row.trace_id === "string" && row.trace_id !== "" ? row.trace_id : null;
  const spanId = typeof row.span_id === "string" && row.span_id !== "" ? row.span_id : null;
  return {
    traceId: traceId !== null && spanId !== null ? traceId : null,
    eventType,
    atMs: parseClickHouseDate(eventAt).getTime(),
    spanId: traceId !== null && spanId !== null ? spanId : null,
    raw: { ...row, body: tryParseJson(row.body), data: tryParseJson(row.data) },
  };
}

export function parseUniqueSpanRows(rows: Record<string, unknown>[]): SpanInput[] {
  const spansByTraceAndId = new Map<string, SpanInput>();
  for (const row of rows) {
    const span = parseSpanRow(row);
    if (span === null) continue;
    const key = `${span.traceId}:${span.id}`;
    if (!spansByTraceAndId.has(key)) spansByTraceAndId.set(key, span);
  }
  return [...spansByTraceAndId.values()];
}

export type TraceLink = {
  ownerSpanId: string,
  linkedTraceId: string,
  linkedSpanId: string,
  linkedProjectId: string,
  linkedBranchId: string,
  targetIsSameScope: boolean,
};

export function parseTraceLinkRow(row: Record<string, unknown>): TraceLink | null {
  if (
    typeof row.owner_span_id !== "string"
    || typeof row.linked_trace_id !== "string"
    || typeof row.linked_span_id !== "string"
    || typeof row.linked_project_id !== "string"
    || typeof row.linked_branch_id !== "string"
  ) return null;
  return {
    ownerSpanId: row.owner_span_id,
    linkedTraceId: row.linked_trace_id,
    linkedSpanId: row.linked_span_id,
    linkedProjectId: row.linked_project_id,
    linkedBranchId: row.linked_branch_id,
    targetIsSameScope: row.target_is_same_scope === 1 || row.target_is_same_scope === true,
  };
}

export function parseTraceLinkRows(rows: Record<string, unknown>[]): TraceLink[] {
  return rows
    .map(parseTraceLinkRow)
    .filter((link): link is TraceLink => link != null)
    .slice(0, SPAN_LINKS_CAP);
}

type TraceRootSpan = SpanInput & {
  activityMs: number,
};

export function parseUniqueTraceRootRows(rows: Record<string, unknown>[]): TraceRootSpan[] {
  return parseUniqueSpanRows(rows).map((span) => {
    const activityAt = span.raw.root_activity_at;
    if (!isDateValue(activityAt)) {
      throw new Error("Trace root query returned a row without root_activity_at");
    }
    return {
      ...span,
      activityMs: parseClickHouseDate(activityAt).getTime(),
    };
  });
}

function EmptyState({ title, children }: { title: string, children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 py-16 text-center">
      <Typography variant="secondary" className="text-sm font-medium">{title}</Typography>
      {children}
    </div>
  );
}

function readInitialTracePageUrlState(): TracePageUrlState {
  if (typeof window === "undefined") return DEFAULT_TRACE_PAGE_URL_STATE;
  return parseTracePageUrlState(new URLSearchParams(window.location.search));
}

function HeaderCountStat({ icon, value, label }: { icon: React.ReactNode, value: number, label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground">
          {icon}
          <span className="font-mono text-[11px] tabular-nums">{value}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const initialUrlState = useState(readInitialTracePageUrlState)[0];

  const [hours, setHours] = useState<TraceTimeRangeHours>(initialUrlState.hours);
  const [service, setService] = useState<ServiceIdentity | null>(initialUrlState.service);
  const [services, setServices] = useState<ServiceIdentity[]>([]);
  const [search, setSearch] = useState(initialUrlState.search);
  const [debouncedSearch] = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [linkedSelection, setLinkedSelection] = useState<{ traceId: string, spanId: string | null } | null>(null);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pinnedTraceId, setPinnedTraceId] = useState<string | null>(initialUrlState.traceId);
  const [highlightSpanId, setHighlightSpanId] = useState<string | null>(initialUrlState.spanId);
  const [highlightEventType, setHighlightEventType] = useState<string | null>(initialUrlState.eventType);
  const [highlightEventAtMs, setHighlightEventAtMs] = useState<number | null>(initialUrlState.eventAtMs);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [seedTraceMiss, setSeedTraceMiss] = useState<string | null>(null);

  const [rootSpans, setRootSpans] = useState<TraceRootSpan[]>([]);
  const [expandedPageViewIds, setExpandedPageViewIds] = useState<ReadonlySet<string>>(() => new Set());
  const [childrenByPageViewId, setChildrenByPageViewId] = useState<ReadonlyMap<string, Trace[]>>(() => new Map());
  const [loadingPageViewIds, setLoadingPageViewIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedSpans, setSelectedSpans] = useState<SpanInput[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<EventInput[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<TraceLink[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [rootLoading, setRootLoading] = useState(true);
  const [rootLoadingMore, setRootLoadingMore] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [rootLoadMoreError, setRootLoadMoreError] = useState<string | null>(null);
  const [rootCursor, setRootCursor] = useState<TraceRootCursor | null>(null);
  const [hasMoreRoots, setHasMoreRoots] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceResultWasCapped, setTraceResultWasCapped] = useState(false);
  const [linksResultWasCapped, setLinksResultWasCapped] = useState(false);
  const [traceVolume, setTraceVolume] = useState<TraceVolumeBucket[]>([]);
  const [traceVolumeLoading, setTraceVolumeLoading] = useState(true);
  const [traceVolumeError, setTraceVolumeError] = useState<string | null>(null);

  const rootRequestSeqRef = useRef(0);
  const rootLoadMoreInFlightRef = useRef(false);
  const traceRequestSeqRef = useRef(0);
  const traceVolumeRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);

  const loadTraceServices = useServiceIdentityLoader(adminApp, TRACE_SERVICES_QUERY);

  const loadRoots = useCallback(async () => {
    const seq = ++rootRequestSeqRef.current;
    setRootLoading(true);
    setRootError(null);
    setRootLoadMoreError(null);
    try {
      const rootQuery = getRecentTraceRootsQuery(null, service, debouncedSearch);
      const [recentRootsResponse, nextServices] = await Promise.all([
        queryObservability(adminApp, {
          query: rootQuery.query,
          params: { ...rootQuery.params, hours },
        }),
        loadTraceServices(),
      ]);
      const recentRootRows = recentRootsResponse.result;
      if (seq !== rootRequestSeqRef.current) return;
      const nextRoots = parseUniqueTraceRootRows(recentRootRows);
      setServices(nextServices);
      setService((current) => (
        current == null || nextServices.some((candidate) => serviceIdentityEquals(candidate, current))
          ? current
          : null
      ));
      setRootSpans(nextRoots);
      const lastRoot = nextRoots.at(-1);
      setRootCursor(lastRoot == null ? null : { activityMs: lastRoot.activityMs, id: lastRoot.id });
      setHasMoreRoots(recentRootRows.length === ROOT_PAGE_SIZE);
      const matchingRoot = pinnedTraceId == null
        ? null
        : (nextRoots.find((span) => span.traceId === pinnedTraceId) ?? null);
      setSeedTraceMiss(pinnedTraceId != null && matchingRoot == null ? pinnedTraceId : null);
      setSelectedRootId((currentRootId) => {
        if (matchingRoot != null) return matchingRoot.id;
        if (pinnedTraceId != null) return null;
        if (currentRootId != null && nextRoots.some((span) => span.id === currentRootId)) return currentRootId;
        return nextRoots[0]?.id ?? null;
      });
      setNowMs(Date.now());
    } catch (e) {
      if (seq !== rootRequestSeqRef.current) return;
      setRootError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === rootRequestSeqRef.current) setRootLoading(false);
    }
  }, [adminApp, debouncedSearch, hours, loadTraceServices, pinnedTraceId, service]);

  const loadTraceVolume = useCallback(async () => {
    const seq = ++traceVolumeRequestSeqRef.current;
    setTraceVolumeLoading(true);
    setTraceVolumeError(null);
    try {
      const volumeQuery = getTraceVolumeQuery(hours, service);
      const response = await queryObservability(adminApp, {
        query: volumeQuery.query,
        params: volumeQuery.params,
      });
      if (seq !== traceVolumeRequestSeqRef.current) return;
      setTraceVolume(parseTraceVolumeRows(response.result));
    } catch (error) {
      if (seq !== traceVolumeRequestSeqRef.current) return;
      setTraceVolumeError(error instanceof Error ? error.message : String(error));
    } finally {
      if (seq === traceVolumeRequestSeqRef.current) setTraceVolumeLoading(false);
    }
  }, [adminApp, hours, service]);

  const loadMoreRoots = useCallback(async () => {
    if (!hasMoreRoots || rootCursor == null || rootLoadMoreInFlightRef.current) return;
    rootLoadMoreInFlightRef.current = true;
    const seq = rootRequestSeqRef.current;
    setRootLoadingMore(true);
    setRootLoadMoreError(null);
    try {
      const rootQuery = getRecentTraceRootsQuery(rootCursor, service, debouncedSearch);
      const response = await queryObservability(adminApp, {
        query: rootQuery.query,
        params: { ...rootQuery.params, hours },
      });
      const nextPageRows = response.result;
      if (seq !== rootRequestSeqRef.current) return;
      const nextPage = parseUniqueTraceRootRows(nextPageRows);
      setRootSpans((currentRoots) => parseUniqueTraceRootRows([
        ...currentRoots.map((span) => span.raw),
        ...nextPageRows,
      ]).sort((a, b) => b.activityMs - a.activityMs || stringCompare(b.id, a.id)));
      const lastRoot = nextPage.at(-1);
      setRootCursor(lastRoot == null ? null : { activityMs: lastRoot.activityMs, id: lastRoot.id });
      setHasMoreRoots(response.result.length === ROOT_PAGE_SIZE);
    } catch (error) {
      if (seq !== rootRequestSeqRef.current) return;
      setRootLoadMoreError(error instanceof Error ? error.message : String(error));
    } finally {
      rootLoadMoreInFlightRef.current = false;
      if (seq === rootRequestSeqRef.current) setRootLoadingMore(false);
    }
  }, [adminApp, debouncedSearch, hasMoreRoots, hours, rootCursor, service]);

  const requestMoreRoots = useCallback(() => {
    runAsynchronouslyWithAlert(loadMoreRoots);
  }, [loadMoreRoots]);

  const loadSelectedTrace = useCallback(async (traceId: string, focusSpanId: string | null = null) => {
    const seq = ++traceRequestSeqRef.current;
    setTraceLoading(true);
    setTraceError(null);
    try {
      const spanQuery = getSelectedTraceSpanQuery(traceId, focusSpanId);
      const linksQuery = getSelectedTraceLinksQuery(traceId);
      const [spansResponse, linksResponse] = await Promise.all([
        queryObservability(adminApp, {
          query: spanQuery.query,
          params: spanQuery.params,
        }),
        queryObservability(adminApp, linksQuery),
      ]);
      if (seq !== traceRequestSeqRef.current) return;
      const spans = parseUniqueSpanRows(spansResponse.result);
      let events: EventInput[] = [];
      if (spans.length > 0) {
        const loadedAtMs = Date.now();
        const spanStartMs = Math.min(...spans.map((span) => span.startMs));
        const spansResultWasCapped = spansResponse.result.length >= TRACE_SPANS_CAP;
        const spanEndMs = spansResultWasCapped
          ? loadedAtMs
          : Math.max(...spans.map((span) => span.endMs ?? loadedAtMs));
        const eventQuery = getSelectedTraceEventQuery(traceId, highlightEventAtMs, {
          startMs: (highlightEventAtMs == null ? spanStartMs : Math.min(spanStartMs, highlightEventAtMs)) - TRACE_EVENT_WINDOW_SLACK_MS,
          endMs: (highlightEventAtMs == null ? spanEndMs : Math.max(spanEndMs, highlightEventAtMs)) + TRACE_EVENT_WINDOW_SLACK_MS,
        });
        const eventsResponse = await queryObservability(adminApp, {
          query: eventQuery.query,
          params: eventQuery.params,
        });
        if (seq !== traceRequestSeqRef.current) return;
        events = eventsResponse.result
          .map(parseEventRow)
          .filter((event): event is EventInput => event != null);
      }
      setSelectedSpans(spans);
      setSelectedEvents(events);
      setSelectedLinks(parseTraceLinkRows(linksResponse.result));
      setTraceResultWasCapped(spansResponse.result.length >= TRACE_SPANS_CAP);
      setLinksResultWasCapped(linksResponse.result.length > SPAN_LINKS_CAP);
      setNowMs(Date.now());
    } catch (e) {
      if (seq !== traceRequestSeqRef.current) return;
      setTraceError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === traceRequestSeqRef.current) setTraceLoading(false);
    }
  }, [adminApp, highlightEventAtMs]);

  const lastAutomaticRootLoadRef = useRef<{
    adminApp: typeof adminApp,
    hours: number,
    service: ServiceIdentity | null,
    search: string,
  } | null>(null);
  useEffect(() => {
    const lastLoad = lastAutomaticRootLoadRef.current;
    if (
      lastLoad?.adminApp === adminApp
      && lastLoad.hours === hours
      && (
        (lastLoad.service == null && service == null)
        || (lastLoad.service != null && service != null && serviceIdentityEquals(lastLoad.service, service))
      )
      && lastLoad.search === debouncedSearch
    ) return;
    lastAutomaticRootLoadRef.current = { adminApp, hours, service, search: debouncedSearch };
    runAsynchronouslyWithAlert(loadRoots);
  }, [adminApp, debouncedSearch, hours, loadRoots, service]);

  useEffect(() => {
    runAsynchronouslyWithAlert(loadTraceVolume);
  }, [loadTraceVolume]);

  const selectedRootTraceId = useMemo(() => (
    selectedRootId == null
      ? null
      : (rootSpans.find((span) => span.id === selectedRootId)?.traceId ?? null)
  ), [rootSpans, selectedRootId]);
  const selectedTraceId = linkedSelection?.traceId ?? pinnedTraceId ?? selectedRootTraceId;
  const selectedTraceServices = useMemo(() => {
    if (selectedRootId == null) return [];
    const selectedRoot = rootSpans.find((span) => span.id === selectedRootId);
    return selectedRoot == null ? [] : serviceIdentitiesFromTraceRow(selectedRoot.raw);
  }, [rootSpans, selectedRootId]);
  const waterfallHighlight = useMemo(() => ({
    spanId: linkedSelection?.spanId ?? highlightSpanId,
    eventType: linkedSelection == null ? highlightEventType : null,
    eventAtMs: linkedSelection == null ? highlightEventAtMs : null,
  }), [highlightEventAtMs, highlightEventType, highlightSpanId, linkedSelection]);

  useEffect(() => {
    replaceLocationSearch(serializeTracePageUrlState({
      hours,
      service,
      search: search.trim(),
      traceId: linkedSelection?.traceId ?? pinnedTraceId,
      spanId: linkedSelection?.spanId ?? (pinnedTraceId == null ? null : highlightSpanId),
      eventType: linkedSelection != null || pinnedTraceId == null ? null : highlightEventType,
      eventAtMs: linkedSelection != null || pinnedTraceId == null ? null : highlightEventAtMs,
    }, readLocationSearch()));
  }, [highlightEventAtMs, highlightEventType, highlightSpanId, hours, linkedSelection, pinnedTraceId, search, service]);

  useEffect(() => {
    if (!shareLinkCopied) return;
    const timeout = window.setTimeout(() => setShareLinkCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [shareLinkCopied]);

  useEffect(() => {
    if (selectedTraceId == null) {
      setSelectedSpans([]);
      setSelectedEvents([]);
      setSelectedLinks([]);
      return;
    }
    runAsynchronouslyWithAlert(loadSelectedTrace(selectedTraceId, linkedSelection?.spanId ?? highlightSpanId));
  }, [highlightSpanId, linkedSelection?.spanId, loadSelectedTrace, selectedTraceId]);

  const { traces: rootTraces } = useMemo(() => buildTraces(rootSpans, []), [rootSpans]);

  const togglePageView = useCallback((pageViewSpanId: string) => {
    setExpandedPageViewIds((previous) => {
      const next = new Set(previous);
      if (next.has(pageViewSpanId)) next.delete(pageViewSpanId);
      else next.add(pageViewSpanId);
      return next;
    });
    if (childrenByPageViewId.has(pageViewSpanId) || loadingPageViewIds.has(pageViewSpanId)) return;
    setLoadingPageViewIds((previous) => new Set(previous).add(pageViewSpanId));
    runAsynchronouslyWithAlert((async () => {
      try {
        const childQuery = getPageViewChildrenQuery(pageViewSpanId);
        const response = await queryObservability(adminApp, childQuery);
        const childSpans = parseUniqueSpanRows(response.result);
        const { traces } = buildTraces(childSpans, []);
        setChildrenByPageViewId((previous) => new Map(previous).set(pageViewSpanId, traces));
      } finally {
        setLoadingPageViewIds((previous) => {
          const next = new Set(previous);
          next.delete(pageViewSpanId);
          return next;
        });
      }
    })());
  }, [adminApp, childrenByPageViewId, loadingPageViewIds]);

  const searchNeedle = search.trim().toLowerCase();

  const { selectedTrace, unattachedEventCount } = useMemo<{ selectedTrace: Trace | null, unattachedEventCount: number }>(() => {
    if (selectedTraceId == null) return { selectedTrace: null, unattachedEventCount: 0 };
    const { traces, unattachedEvents } = buildTraces(selectedSpans, selectedEvents);
    return {
      selectedTrace: linkedSelection?.spanId == null
        ? selectPrimaryTrace(traces, selectedTraceId)
        : traces.find((trace) => traceContainsSpanId(trace, linkedSelection.spanId ?? "")) ?? null,
      unattachedEventCount: unattachedEvents.length,
    };
  }, [linkedSelection, selectedEvents, selectedSpans, selectedTraceId]);

  const openEventDetail = useCallback((raw: Record<string, unknown>) => {
    detailRequestSeqRef.current += 1;
    setDetailLoading(false);
    setDetailRow(raw);
  }, []);

  const openSpanDetail = useCallback(async (span: SpanInput) => {
    const seq = ++detailRequestSeqRef.current;
    setDetailRow(span.raw);
    setDetailLoading(true);
    try {
      const detailQuery = getSpanDetailQuery(span.traceId, span.id);
      const response = await queryObservability(adminApp, {
        query: detailQuery.query,
        params: detailQuery.params,
      });
      if (seq !== detailRequestSeqRef.current) return;
      const detailResult = response.result.at(0);
      if (detailResult == null) {
        throw new Error(`Span ${JSON.stringify(span.id)} no longer exists in trace ${JSON.stringify(span.traceId)}`);
      }
      const parsedDetail = parseSpanRow(detailResult);
      if (parsedDetail == null) {
        throw new Error(`Span detail query returned an invalid row for ${JSON.stringify(span.id)}`);
      }
      setDetailRow(parsedDetail.raw);
    } finally {
      if (seq === detailRequestSeqRef.current) setDetailLoading(false);
    }
  }, [adminApp]);

  const refresh = useCallback(async () => {
    await Promise.all([
      loadRoots(),
      loadTraceVolume(),
      selectedTraceId == null
        ? Promise.resolve()
        : loadSelectedTrace(selectedTraceId, linkedSelection?.spanId ?? highlightSpanId),
    ]);
  }, [highlightSpanId, linkedSelection?.spanId, loadRoots, loadSelectedTrace, loadTraceVolume, selectedTraceId]);

  const headerActions = (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <DesignSelectorDropdown
          value={serviceIdentityToSelectValue(service)}
          onValueChange={(value) => setService(selectValueToServiceIdentity(value))}
          options={[
            { value: ALL_SERVICES_SELECT_VALUE, label: "All services" },
            ...services.map((identity) => ({
              value: serviceIdentityToSelectValue(identity),
              label: serviceIdentityLabel(identity),
            })),
          ]}
          size="sm"
          disabled={rootLoading}
        />
        <div className="flex items-center gap-1 whitespace-nowrap text-xs">
          <HeaderCountStat icon={<TreeStructureIcon className="h-3.5 w-3.5" />} value={rootTraces.length} label={`${rootTraces.length.toLocaleString()} ${rootTraces.length === 1 ? "trace" : "traces"}`} />
          <HeaderCountStat icon={<StackIcon className="h-3.5 w-3.5" />} value={selectedTrace?.spanCount ?? 0} label={`${(selectedTrace?.spanCount ?? 0).toLocaleString()} spans in the selected trace`} />
          <HeaderCountStat icon={<ChartLineIcon className="h-3.5 w-3.5" />} value={selectedTrace?.eventCount ?? 0} label={`${(selectedTrace?.eventCount ?? 0).toLocaleString()} events in the selected trace`} />
          {selectedLinks.length > 0 && (
            <HeaderCountStat icon={<LinkSimpleIcon className="h-3.5 w-3.5" />} value={selectedLinks.length} label={`${selectedLinks.length.toLocaleString()} non-hierarchical span ${selectedLinks.length === 1 ? "link" : "links"} in the selected trace`} />
          )}
        </div>
        <span className="h-5 w-px shrink-0 bg-border/60" aria-hidden />
        <DesignPillToggle
          selected={String(hours)}
          onSelect={(id) => setHours(parseObservabilityTimeRangeId(id))}
          options={OBSERVABILITY_TIME_RANGE_OPTIONS}
          size="sm"
          glassmorphic={false}
        />
        <DesignButton
          className="shrink-0 gap-1.5"
          variant="secondary"
          size="sm"
          loading={rootLoading || traceLoading || traceVolumeLoading}
          onClick={refresh}
        >
          <ArrowClockwiseIcon className="h-4 w-4" />
          Refresh
        </DesignButton>
        <DesignButton
          className="shrink-0"
          variant="secondary"
          size="sm"
          aria-label={shareLinkCopied ? "Link copied" : "Copy link to this view"}
          title={shareLinkCopied ? "Copied!" : "Copy link to this view"}
          onClick={() => runAsynchronouslyWithAlert(async () => {
            const viewedId = linkedSelection?.traceId ?? pinnedTraceId ?? selectedTraceId;
            if (viewedId != null && pinnedTraceId == null && linkedSelection == null) setPinnedTraceId(viewedId);
            const params = serializeTracePageUrlState({
              hours,
              service,
              search: search.trim(),
              traceId: viewedId,
              spanId: linkedSelection?.spanId ?? highlightSpanId,
              eventType: linkedSelection != null ? null : highlightEventType,
              eventAtMs: linkedSelection != null ? null : highlightEventAtMs,
            }, new URLSearchParams());
            const query = params.toString();
            await navigator.clipboard.writeText(
              `${window.location.origin}${window.location.pathname}${query === "" ? "" : `?${query}`}`,
            );
            setShareLinkCopied(true);
          })}
        >
          {shareLinkCopied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
        </DesignButton>
      </div>
    </TooltipProvider>
  );

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout fillWidth scrollMain spacing="compact">
        <StickyPageHeader
          title="Traces"
          actions={headerActions}
          sticky
          layoutGroupId="traces-sticky-header"
          scrollContainer="main"
        />

        <div className="empty:hidden">
          <AnalyticsEventLimitBanner />
        </div>

        {seedTraceMiss != null && (
          <DesignAlert
            variant="info"
            title="That trace isn't in this window"
            description={
              <>
                Nothing in the last {hours}h inbox matches trace{" "}
                <code className="font-mono">{seedTraceMiss}</code>. The waterfall below still
                loads it. Widen the time range, or clear the service filter, to find it in the
                list.
              </>
            }
          />
        )}

        {traceResultWasCapped && !traceLoading && traceError == null && (
          <DesignAlert
            variant="warning"
            title="Selected trace is unusually large"
            description="Showing the earliest 10,000 spans in this trace."
          />
        )}

        {linksResultWasCapped && !traceLoading && traceError == null && (
          <DesignAlert
            variant="warning"
            title="Selected trace has an unusually large number of span links"
            description={`Showing the first ${SPAN_LINKS_CAP.toLocaleString()} span links in this trace; further links exist but are not listed.`}
          />
        )}

        <TraceVolumeChart
          buckets={traceVolume}
          hours={hours}
          loading={traceVolumeLoading}
          error={traceVolumeError}
          onRetry={loadTraceVolume}
        />

        <div className="grid min-w-0 flex-1 gap-[var(--page-content-gap)] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="min-h-0 lg:[contain:size]" aria-label="Trace list">
            <div
              className={cn(
                CARD_CLASSES,
                "flex h-full max-h-[45dvh] w-full flex-col overflow-hidden",
                "lg:sticky lg:top-3 lg:max-h-[calc(100cqh-0.75rem)]",
              )}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
                <DesignInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter…"
                  size="sm"
                  className="min-w-0 flex-1"
                />
                {!rootLoading && rootError == null && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{rootTraces.length.toLocaleString()}</span>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {rootLoading && (
                  <div className="flex items-center justify-center py-16">
                    <SpinnerGapIcon className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!rootLoading && rootError != null && (
                  <ErrorDisplay error={rootError} onRetry={loadRoots} />
                )}
                {!rootLoading && rootError == null && rootTraces.length === 0 && (
                  <EmptyState title={search.trim() !== "" ? "No traces match the filter." : "No spans in this time range."}>
                    {search.trim() === "" && (
                      <pre className="text-left font-mono text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-auto max-w-full">
                        {`const span = app.startSpan("checkout");\nawait span.trackEvent("item_added",\n  { sku: "T-100" });\nawait span.end();`}
                      </pre>
                    )}
                  </EmptyState>
                )}
                {!rootLoading && rootError == null && rootTraces.length > 0 && (
                  <SpanTreeList
                    traces={rootTraces}
                    nowMs={nowMs}
                    activeSpanId={selectedRootId}
                    onSelectSpan={(rootId) => {
                      setLinkedSelection(null);
                      setSelectedRootId(rootId);
                      const root = rootSpans.find((span) => span.id === rootId);
                      setPinnedTraceId(root?.traceId ?? null);
                      setHighlightSpanId(null);
                      setHighlightEventType(null);
                      setHighlightEventAtMs(null);
                    }}
                    expandedPageViewIds={expandedPageViewIds}
                    childrenByPageViewId={childrenByPageViewId}
                    loadingPageViewIds={loadingPageViewIds}
                    onTogglePageView={togglePageView}
                    hasMore={hasMoreRoots}
                    loadingMore={rootLoadingMore}
                    loadMoreError={rootLoadMoreError}
                    onLoadMore={requestMoreRoots}
                  />
                )}
              </div>
            </div>
          </aside>

          <section
            aria-label="Selected trace waterfall"
            className={cn(CARD_CLASSES, "flex min-h-[420px] min-w-0 self-start flex-col overflow-hidden")}
          >
            {linkedSelection !== null && (
              <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-foreground/[0.03] px-3 py-2">
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Following span link</span>{" "}
                  <span className="font-mono">{(pinnedTraceId ?? selectedRootTraceId)?.slice(0, 8) ?? "trace"}</span>{" → "}
                  <span className="font-mono">{linkedSelection.traceId.slice(0, 8)}/{linkedSelection.spanId?.slice(0, 6) ?? "root"}</span>
                </div>
                <DesignButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setLinkedSelection(null)}
                >
                  Back to originating trace
                </DesignButton>
              </div>
            )}
            {traceLoading && (
              <div className="flex flex-1 items-center justify-center py-24">
                <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!traceLoading && traceError == null && selectedTrace == null && linkedSelection === null && (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState title="Select a trace to see its waterfall." />
              </div>
            )}
            {!traceLoading && traceError == null && selectedTrace == null && linkedSelection !== null && (
              <div className="p-4">
                <DesignAlert
                  variant="warning"
                  title="Linked span is unavailable"
                  description="The link was retained, but its same-project target was not found. The linked trace may have been sampled out independently, expired, or not arrived yet."
                />
              </div>
            )}
            {!traceLoading && traceError == null && selectedTrace != null && (
              <TraceWaterfall
                trace={selectedTrace}
                services={linkedSelection === null ? selectedTraceServices : []}
                nowMs={nowMs}
                needle={searchNeedle}
                unattachedEventCount={unattachedEventCount}
                links={selectedLinks}
                highlight={waterfallHighlight}
                onSelectSpan={(span) => {
                  setPinnedTraceId(span.traceId);
                  setHighlightSpanId(span.id);
                  setHighlightEventType(null);
                  setHighlightEventAtMs(null);
                  runAsynchronouslyWithAlert(openSpanDetail(span));
                }}
                onSelectEvent={(event) => {
                  setPinnedTraceId(event.traceId ?? selectedTraceId);
                  setHighlightSpanId(event.spanId);
                  setHighlightEventType(event.eventType);
                  setHighlightEventAtMs(event.atMs);
                  openEventDetail(event.raw);
                }}
                onOpenLink={(link) => {
                  setLinkedSelection({ traceId: link.linkedTraceId, spanId: link.linkedSpanId });
                }}
              />
            )}
            {!traceLoading && traceError != null && (
              <div className="flex flex-1 items-center justify-center py-24">
                <ErrorDisplay
                  error={traceError}
                  onRetry={() => (
                    selectedTraceId == null
                      ? Promise.resolve()
                      : loadSelectedTrace(selectedTraceId)
                  )}
                />
              </div>
            )}
          </section>
        </div>

        <RowDetailDialog
          row={detailRow}
          columns={detailRow != null ? Object.keys(detailRow) : []}
          open={detailRow != null}
          technicalColumns={SPAN_TECHNICAL_DETAIL_COLUMNS}
          loading={detailLoading}
          extraContent={detailRow == null ? null : (
            <TelemetryRowLinks row={detailRow} projectId={adminApp.projectId} showTrace={false} />
          )}
          onOpenChange={(open) => {
            if (!open) {
              detailRequestSeqRef.current += 1;
              setDetailLoading(false);
              setDetailRow(null);
            }
          }}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
