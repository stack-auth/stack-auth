"use client";

import { DesignAlert, DesignButton, DesignInput, DesignPillToggle, DesignSelectorDropdown } from "@/components/design-components";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { ArrowClockwiseIcon, ChartLineIcon, SpinnerGapIcon, StackIcon, TreeStructureIcon } from "@phosphor-icons/react";
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
  spliceBridgedSubtraces,
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

const TRACE_SPAN_STRUCTURE_SELECT_SQL = `
SELECT
  s.trace_id,
  s.span_id,
  s.span_type,
  s.started_at,
  s.ended_at,
  s.parent_span_ids,
  s.status_code
FROM default.spans AS s
`;

const ROOT_PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;
const ALL_SERVICES_SELECT_VALUE = "all";

export const TRACE_SERVICES_QUERY = `
SELECT service_namespace, service_name
FROM default.trace_services
WHERE service_name != ''
GROUP BY service_namespace, service_name
ORDER BY service_namespace ASC, service_name ASC
LIMIT 500
`;

export type TraceRootCursor = {
  startMs: number,
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
      r.started_at < fromUnixTimestamp64Milli({cursorStartMs:Int64})
      OR (r.started_at = fromUnixTimestamp64Milli({cursorStartMs:Int64}) AND r.span_id < {cursorId:String})
    )`;
  return {
    query: `
SELECT
  r.trace_id AS trace_id,
  r.span_id,
  r.span_type,
  r.started_at,
  r.ended_at,
  r.status_code,
  r.data,
  CAST([], 'Array(String)') AS parent_span_ids,
  u.display_name AS user_display_name,
  u.primary_email AS user_primary_email,
  u.profile_image_url AS user_profile_image_url,
  'span' AS root_source,
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
WHERE r.started_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
  AND r.span_type != '$http-client'
  ${serviceCondition}${searchCondition}${cursorCondition}
ORDER BY r.started_at DESC, r.span_id DESC
LIMIT ${ROOT_PAGE_SIZE}
`,
    params: {
      ...(cursor == null ? {} : { cursorStartMs: cursor.startMs, cursorId: cursor.id }),
      ...(service == null ? {} : {
        serviceNamespace: service.namespace,
        serviceName: service.name,
      }),
      ...(search === "" ? {} : { search }),
    },
  };
}

// Bridge CTE: the W3C trace ids derivable from this trace's `$http-client`
// spans (uuid after `hc-`, dash-stripped — the exact `traceparent` the SDK
// sent). Selecting `trace_id IN bridged` alongside the native trace pulls the
// backend sub-traces (stored under those W3C trace ids) that those fetches
// caused into the SAME result set; spliceBridgedSubtraces (trace-utils.ts)
// then reparents them under their bridge span at render time. Pure read-time
// join — ingestion never correlates the two namespaces.
const BRIDGED_TRACE_IDS_CTE_SQL = `
WITH forward_bridged AS (
  SELECT lower(replaceAll(substring(span_id, 4), '-', '')) AS w3c_trace_id
  FROM default.spans
  WHERE trace_id = {traceId:String} AND startsWith(span_id, 'hc-')
),
reverse_bridge AS (
  SELECT span_id, parent_span_ids
  FROM default.spans
  WHERE startsWith(span_id, 'hc-')
    AND lower(replaceAll(substring(span_id, 4), '-', '')) = lower({traceId:String})
),
reverse_bridge_ancestors AS (
  SELECT arrayJoin(parent_span_ids) AS span_id
  FROM reverse_bridge
)
`;

export function getSelectedTraceSpanQuery(traceId: string): {
  query: string,
  params: Record<string, string | number>,
} {
  return {
    query: `
${BRIDGED_TRACE_IDS_CTE_SQL}
${TRACE_SPAN_STRUCTURE_SELECT_SQL}
WHERE s.trace_id = {traceId:String}
  OR s.trace_id IN (SELECT w3c_trace_id FROM forward_bridged)
  OR s.span_id IN (SELECT span_id FROM reverse_bridge)
  OR s.span_id IN (SELECT span_id FROM reverse_bridge_ancestors)
-- A long-lived refresh-token trace can bridge to more than 10,000 backend
-- spans. Keep its native session/replay/page/http rows ahead of bridged detail
-- so LIMIT can never discard the selected root and leave a blank waterfall.
ORDER BY s.trace_id = {traceId:String} DESC, s.started_at ASC
LIMIT 10000
`,
    params: { traceId },
  };
}

// Every column the span detail dialog shows (RowDetailDialog renders all
// returned columns, and parseSpanRow needs trace_id/span_id/span_type/
// started_at plus the data/resource_attributes JSON blobs). Enumerated
// instead of SELECT * because default.spans is a FINAL + UNION ALL view: an
// explicit list keeps this point lookup from reading columns we never display
// and keeps the dialog stable if the view ever grows internal columns.
// project_id/branch_id are deliberately excluded — the analytics endpoint
// already scopes every row to the current project/branch, so they'd be
// constant noise in the dialog. Ordered native-fields-first so the dialog
// (which renders columns in this order) leads with what a product user reads;
// everything from SPAN_TECHNICAL_DETAIL_COLUMNS onward lands in the collapsed
// "Technical details" section.
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
  "parent_span_ids",
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

// Raw identifiers and instrumentation plumbing — collapsed behind the
// "Technical details" disclosure in the shared RowDetailDialog. Also applies
// to event rows (which share the dialog): only the columns present on the
// row are rendered. root_source/user_display_name etc. are grid-only helper
// columns on preloaded root rows; they're hidden with the identifiers too.
export const SPAN_TECHNICAL_DETAIL_COLUMNS: readonly string[] = [
  "trace_id",
  "span_id",
  "parent_span_ids",
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
  "root_source",
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

export function getSelectedTraceEventQuery(traceId: string, hours: number): {
  query: string,
  params: Record<string, string | number>,
} {
  return {
    query: `
${BRIDGED_TRACE_IDS_CTE_SQL}
SELECT event_type, event_at, data, user_id, parent_span_ids,
       refresh_token_id, session_replay_id, session_replay_segment_id
FROM (
  SELECT * FROM default.events
  UNION ALL
  SELECT * FROM default.logs
  UNION ALL
  SELECT * FROM default.errors
  UNION ALL
  SELECT * FROM default.span_events
)
WHERE (trace_id = {traceId:String} OR trace_id IN (SELECT w3c_trace_id FROM forward_bridged))
  AND event_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
ORDER BY event_at ASC
LIMIT 5000
`,
    params: { traceId, hours },
  };
}

const TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

const CARD_CLASSES = "rounded-2xl border border-black/[0.06] bg-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-zinc-900/90";

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseSpanRow(row: Record<string, unknown>): SpanInput | null {
  const traceId = row.trace_id;
  const id = row.span_id;
  const spanType = row.span_type;
  const startedAt = row.started_at;
  if (typeof traceId !== "string" || typeof id !== "string" || typeof spanType !== "string" || !isDateValue(startedAt)) return null;
  const endedAt = row.ended_at;
  const parentSpanIds = Array.isArray(row.parent_span_ids)
    ? row.parent_span_ids.filter((value): value is string => typeof value === "string")
    : [];
  return {
    traceId,
    id,
    spanType,
    startMs: parseClickHouseDate(startedAt).getTime(),
    endMs: isDateValue(endedAt) ? parseClickHouseDate(endedAt).getTime() : null,
    parentSpanIds,
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
  const parentSpanIds = Array.isArray(row.parent_span_ids)
    ? row.parent_span_ids.filter((value): value is string => typeof value === "string")
    : [];
  return {
    eventType,
    atMs: parseClickHouseDate(eventAt).getTime(),
    parentSpanIds,
    // Depending on the analytics response surface, events.data can arrive as
    // either decoded JSON or its serialized representation. Normalize it just
    // like spans so the shared detail dialog always renders structured data.
    raw: { ...row, data: tryParseJson(row.data) },
  };
}

export function parseUniqueSpanRows(rows: Record<string, unknown>[]): SpanInput[] {
  const spansById = new Map<string, SpanInput>();
  for (const row of rows) {
    const span = parseSpanRow(row);
    if (span != null && !spansById.has(span.id)) spansById.set(span.id, span);
  }
  return [...spansById.values()];
}

function EmptyState({ title, children }: { title: string, children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 py-16 text-center">
      <Typography variant="secondary" className="text-sm font-medium">{title}</Typography>
      {children}
    </div>
  );
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

  const [hours, setHours] = useState<TraceTimeRangeHours>(24);
  const [service, setService] = useState<ServiceIdentity | null>(null);
  const [services, setServices] = useState<ServiceIdentity[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [rootSpans, setRootSpans] = useState<SpanInput[]>([]);
  const [selectedSpans, setSelectedSpans] = useState<SpanInput[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<EventInput[]>([]);
  // "Now" reference for the waterfall/list: fixed at load time so intervals
  // reaching into the future (e.g. $refresh-token expiry) render as ongoing.
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
  const [traceVolume, setTraceVolume] = useState<TraceVolumeBucket[]>([]);
  const [traceVolumeLoading, setTraceVolumeLoading] = useState(true);
  const [traceVolumeError, setTraceVolumeError] = useState<string | null>(null);

  const rootRequestSeqRef = useRef(0);
  const rootLoadMoreInFlightRef = useRef(false);
  const traceRequestSeqRef = useRef(0);
  const traceVolumeRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const traceServicesRequestRef = useRef<{
    adminApp: typeof adminApp,
    promise: Promise<ServiceIdentity[]>,
  } | null>(null);

  const loadTraceServices = useCallback(() => {
    const currentRequest = traceServicesRequestRef.current;
    if (currentRequest?.adminApp === adminApp) return currentRequest.promise;

    const promise = (async () => {
      try {
        const response = await adminApp.queryAnalytics({
          query: TRACE_SERVICES_QUERY,
          params: {},
          include_all_branches: false,
          timeout_ms: 30000,
        });
        return response.result.map(parseServiceIdentityRow);
      } catch (error) {
        if (traceServicesRequestRef.current?.adminApp === adminApp) {
          traceServicesRequestRef.current = null;
        }
        throw error;
      }
    })();
    traceServicesRequestRef.current = { adminApp, promise };
    return promise;
  }, [adminApp]);

  const loadRoots = useCallback(async () => {
    const seq = ++rootRequestSeqRef.current;
    setRootLoading(true);
    setRootError(null);
    setRootLoadMoreError(null);
    try {
      const rootQuery = getRecentTraceRootsQuery(null, service, debouncedSearch);
      const [recentRootsResponse, nextServices] = await Promise.all([
        adminApp.queryAnalytics({
          query: rootQuery.query,
          params: { ...rootQuery.params, hours },
          include_all_branches: false,
          timeout_ms: 30000,
        }),
        loadTraceServices(),
      ]);
      const recentRootRows = recentRootsResponse.result;
      if (seq !== rootRequestSeqRef.current) return;
      const nextRoots = parseUniqueSpanRows(recentRootRows);
      setServices(nextServices);
      setService((current) => (
        current == null || nextServices.some((candidate) => serviceIdentityEquals(candidate, current))
          ? current
          : null
      ));
      setRootSpans(nextRoots);
      const lastRoot = nextRoots.at(-1);
      setRootCursor(lastRoot == null ? null : { startMs: lastRoot.startMs, id: lastRoot.id });
      setHasMoreRoots(recentRootRows.length === ROOT_PAGE_SIZE);
      setSelectedRootId((currentRootId) => (
        currentRootId != null && nextRoots.some((span) => span.id === currentRootId)
          ? currentRootId
          : (nextRoots[0]?.id ?? null)
      ));
      setNowMs(Date.now());
    } catch (e) {
      if (seq !== rootRequestSeqRef.current) return;
      setRootError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === rootRequestSeqRef.current) setRootLoading(false);
    }
  }, [adminApp, debouncedSearch, hours, loadTraceServices, service]);

  const loadTraceVolume = useCallback(async () => {
    const seq = ++traceVolumeRequestSeqRef.current;
    setTraceVolumeLoading(true);
    setTraceVolumeError(null);
    try {
      const volumeQuery = getTraceVolumeQuery(hours, service);
      const response = await adminApp.queryAnalytics({
        query: volumeQuery.query,
        params: volumeQuery.params,
        include_all_branches: false,
        timeout_ms: 30000,
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
      const response = await adminApp.queryAnalytics({
        query: rootQuery.query,
        params: { ...rootQuery.params, hours },
        include_all_branches: false,
        timeout_ms: 30000,
      });
      const nextPageRows = response.result;
      if (seq !== rootRequestSeqRef.current) return;
      const nextPage = parseUniqueSpanRows(nextPageRows);
      setRootSpans((currentRoots) => parseUniqueSpanRows([
        ...currentRoots.map((span) => span.raw),
        ...nextPageRows,
      ]).sort((a, b) => b.startMs - a.startMs || stringCompare(b.id, a.id)));
      const lastRoot = nextPage.at(-1);
      setRootCursor(lastRoot == null ? null : { startMs: lastRoot.startMs, id: lastRoot.id });
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

  const loadSelectedTrace = useCallback(async (traceId: string) => {
    const seq = ++traceRequestSeqRef.current;
    setTraceLoading(true);
    setTraceError(null);
    try {
      const spanQuery = getSelectedTraceSpanQuery(traceId);
      const eventQuery = getSelectedTraceEventQuery(traceId, hours);
      const [spansResponse, eventsResponse] = await Promise.all([
        adminApp.queryAnalytics({
          query: spanQuery.query,
          params: spanQuery.params,
          include_all_branches: false,
          timeout_ms: 30000,
        }),
        adminApp.queryAnalytics({
          query: eventQuery.query,
          params: eventQuery.params,
          include_all_branches: false,
          timeout_ms: 30000,
        }),
      ]);
      if (seq !== traceRequestSeqRef.current) return;
      setSelectedSpans(parseUniqueSpanRows(spansResponse.result));
      setSelectedEvents(eventsResponse.result
        .map(parseEventRow)
        .filter((event): event is EventInput => event != null));
      setTraceResultWasCapped(spansResponse.result.length >= 10000);
      setNowMs(Date.now());
    } catch (e) {
      if (seq !== traceRequestSeqRef.current) return;
      setTraceError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === traceRequestSeqRef.current) setTraceLoading(false);
    }
  }, [adminApp, hours]);

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
  const selectedTraceServices = useMemo(() => {
    if (selectedRootId == null) return [];
    const selectedRoot = rootSpans.find((span) => span.id === selectedRootId);
    return selectedRoot == null ? [] : serviceIdentitiesFromTraceRow(selectedRoot.raw);
  }, [rootSpans, selectedRootId]);

  useEffect(() => {
    if (selectedRootId == null || selectedRootTraceId == null) {
      setSelectedSpans([]);
      setSelectedEvents([]);
      return;
    }
    runAsynchronouslyWithAlert(loadSelectedTrace(selectedRootTraceId));
  }, [loadSelectedTrace, selectedRootId, selectedRootTraceId]);

  const { traces: rootTraces } = useMemo(() => buildTraces(rootSpans, []), [rootSpans]);

  const searchNeedle = search.trim().toLowerCase();

  const selectedTrace = useMemo<Trace | null>(() => {
    if (selectedRootId == null) return null;
    // Reparent the backend sub-traces (pulled in via the bridged CTE)
    // under their $http-client bridge spans before building the tree — this is
    // what renders one connected client→server waterfall.
    const { traces } = buildTraces(spliceBridgedSubtraces(selectedSpans), selectedEvents);
    return traces.find((trace) => traceContainsSpanId(trace, selectedRootId)) ?? null;
  }, [selectedEvents, selectedRootId, selectedSpans]);

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
      const response = await adminApp.queryAnalytics({
        query: detailQuery.query,
        params: detailQuery.params,
        include_all_branches: false,
        timeout_ms: 30000,
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
      selectedRootId == null || selectedRootTraceId == null
        ? Promise.resolve()
        : loadSelectedTrace(selectedRootTraceId),
    ]);
  }, [loadRoots, loadSelectedTrace, loadTraceVolume, selectedRootId, selectedRootTraceId]);

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
          <HeaderCountStat icon={<TreeStructureIcon className="h-3.5 w-3.5" />} value={rootTraces.length} label={`${rootTraces.length.toLocaleString()} parent ${rootTraces.length === 1 ? "trace" : "traces"}`} />
          <HeaderCountStat icon={<StackIcon className="h-3.5 w-3.5" />} value={selectedTrace?.spanCount ?? 0} label={`${(selectedTrace?.spanCount ?? 0).toLocaleString()} spans in the selected trace`} />
          <HeaderCountStat icon={<ChartLineIcon className="h-3.5 w-3.5" />} value={selectedTrace?.eventCount ?? 0} label={`${(selectedTrace?.eventCount ?? 0).toLocaleString()} events in the selected trace`} />
        </div>
        <span className="h-5 w-px shrink-0 bg-border/60" aria-hidden />
        <DesignPillToggle
          selected={String(hours)}
          onSelect={(id) => {
            const range = TIME_RANGES.find((candidate) => String(candidate.hours) === id);
            if (range == null) throw new Error(`Unknown trace time range: ${id}`);
            setHours(range.hours);
          }}
          options={TIME_RANGES.map((range) => ({ label: range.label, id: String(range.hours) }))}
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

        {traceResultWasCapped && !traceLoading && traceError == null && (
          <DesignAlert
            variant="warning"
            title="Selected trace is unusually large"
            description="Showing the first 10,000 spans nested under this parent trace."
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
          {/* This panel is constrained by main's actual scrollport, not the
              browser viewport. It therefore remains flush with the page's
              bottom gutter regardless of shell or sticky-header height. */}
          {/* Size containment prevents the virtual canvas from determining the
              desktop grid row; the waterfall is the page-length authority. */}
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
                    onSelectSpan={(rootId) => setSelectedRootId(rootId)}
                    hasMore={hasMoreRoots}
                    loadingMore={rootLoadingMore}
                    loadMoreError={rootLoadMoreError}
                    onLoadMore={requestMoreRoots}
                  />
                )}
              </div>
            </div>
          </aside>

          {/* Waterfall rows participate in main's page-level scroll. */}
          <section
            aria-label="Selected trace waterfall"
            className={cn(CARD_CLASSES, "flex min-h-[420px] min-w-0 self-start flex-col overflow-hidden")}
          >
            {traceLoading && (
              <div className="flex flex-1 items-center justify-center py-24">
                <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!traceLoading && traceError == null && selectedTrace == null && (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState title="Select a trace to see its waterfall." />
              </div>
            )}
            {!traceLoading && traceError == null && selectedTrace != null && (
              <TraceWaterfall
                trace={selectedTrace}
                services={selectedTraceServices}
                nowMs={nowMs}
                needle={searchNeedle}
                onSelectSpan={(span) => runAsynchronouslyWithAlert(openSpanDetail(span))}
                onSelectEvent={(event) => openEventDetail(event.raw)}
              />
            )}
            {!traceLoading && traceError != null && (
              <div className="flex flex-1 items-center justify-center py-24">
                <ErrorDisplay
                  error={traceError}
                  onRetry={() => (
                    selectedRootId == null || selectedRootTraceId == null
                      ? Promise.resolve()
                      : loadSelectedTrace(selectedRootTraceId)
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
