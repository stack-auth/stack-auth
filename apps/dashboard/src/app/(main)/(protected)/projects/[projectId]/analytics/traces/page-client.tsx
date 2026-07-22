"use client";

import { Button, Input, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon, ChartLineIcon, SpinnerGapIcon, StackIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../shared";
import { SpanTreeList } from "./span-tree";
import {
  buildTraces,
  isSystemSpanType,
  rerootTrace,
  subtreeMatches,
  type EventInput,
  type SpanInput,
  type Trace,
} from "./trace-utils";
import { TraceWaterfall, type TraceBreadcrumb } from "./waterfall";

const SPAN_SELECT_SQL = `
SELECT
  s.id,
  s.span_type,
  s.span_started_at,
  s.span_ended_at,
  s.parent_span_ids,
  s.data,
  s.user_id,
  s.refresh_token_id,
  s.session_replay_id,
  s.session_replay_segment_id,
  u.display_name AS user_display_name,
  u.primary_email AS user_primary_email,
  u.profile_image_url AS user_profile_image_url
FROM default.spans AS s
LEFT ANY JOIN default.users AS u
  ON s.project_id = u.project_id
  AND s.branch_id = u.branch_id
  AND s.user_id = toString(u.id)
`;

const RECENT_SPANS_QUERY = `
${SPAN_SELECT_SQL}
WHERE s.span_started_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
ORDER BY s.span_started_at DESC
LIMIT 3000
`;

const ACTIVE_REFRESH_TOKEN_ROOTS_QUERY = `
${SPAN_SELECT_SQL}
WHERE s.span_type = '$refresh-token'
  AND (s.span_ended_at IS NULL OR s.span_ended_at >= now64(3) - INTERVAL {hours:UInt32} HOUR)
ORDER BY s.span_started_at DESC
LIMIT 3000
`;

const SPANS_BY_ID_QUERY = `
${SPAN_SELECT_SQL}
WHERE s.id IN ({spanIds:Array(String)})
`;

// Events are not browsable on this page, but they still render as markers
// inside their parent span's waterfall row, so we fetch them for correlation.
const EVENTS_QUERY = `
SELECT event_type, event_at, data, user_id, parent_span_ids,
       refresh_token_id, session_replay_id, session_replay_segment_id
FROM default.events
WHERE event_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
ORDER BY event_at DESC
LIMIT 3000
`;

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
  const id = row.id;
  const spanType = row.span_type;
  const startedAt = row.span_started_at;
  if (typeof id !== "string" || typeof spanType !== "string" || !isDateValue(startedAt)) return null;
  const endedAt = row.span_ended_at;
  const parentSpanIds = Array.isArray(row.parent_span_ids)
    ? row.parent_span_ids.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id,
    spanType,
    startMs: parseClickHouseDate(startedAt).getTime(),
    endMs: isDateValue(endedAt) ? parseClickHouseDate(endedAt).getTime() : null,
    parentSpanIds,
    // The spans data column is a JSON string; parse it so the detail dialog
    // pretty-prints instead of showing an escaped blob.
    raw: { ...row, data: tryParseJson(row.data) },
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

export function collectRefreshTokenParentIds(rows: Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.parent_span_ids)) continue;
    for (const parentId of row.parent_span_ids) {
      if (typeof parentId === "string" && parentId.startsWith("rti-")) ids.add(parentId);
    }
  }
  return [...ids];
}

export function parseUniqueSpanRows(rows: Record<string, unknown>[]): SpanInput[] {
  const spansById = new Map<string, SpanInput>();
  for (const row of rows) {
    const span = parseSpanRow(row);
    if (span != null && !spansById.has(span.id)) spansById.set(span.id, span);
  }
  return [...spansById.values()];
}

function Segmented<T extends string | number>({ value, onChange, options }: {
  value: T,
  onChange: (value: T) => void,
  options: readonly { label: string, value: T }[],
}) {
  return (
    <div className="flex items-center rounded-lg bg-foreground/[0.04] p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:transition-none",
            value === option.value
              ? "bg-white text-foreground shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-950 dark:ring-white/[0.06]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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

  const [hours, setHours] = useState<number>(24);
  const [scope, setScope] = useState<"custom" | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);

  const [spans, setSpans] = useState<SpanInput[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  // "Now" reference for the waterfall/list: fixed at load time so intervals
  // reaching into the future (e.g. $refresh-token expiry) render as ongoing.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [spansResponse, eventsResponse, refreshTokenRootsResponse] = await Promise.all([
        adminApp.queryAnalytics({
          query: RECENT_SPANS_QUERY,
          params: { hours },
          include_all_branches: false,
          timeout_ms: 30000,
        }),
        adminApp.queryAnalytics({
          query: EVENTS_QUERY,
          params: { hours },
          include_all_branches: false,
          timeout_ms: 30000,
        }),
        // Reserve a separate result budget for long-lived system roots. They
        // remain useful standalone traces in All scope even when no visible
        // descendant references them, and must not compete with recent spans.
        adminApp.queryAnalytics({
          query: ACTIVE_REFRESH_TOKEN_ROOTS_QUERY,
          params: { hours },
          include_all_branches: false,
          timeout_ms: 30000,
        }),
      ]);
      // A refresh-token span can start days before the selected window. Fetch
      // the exact roots referenced by the visible rows separately so the 3,000
      // recent-span cap cannot evict them and orphan their event markers.
      const refreshTokenParentIds = collectRefreshTokenParentIds([
        ...spansResponse.result,
        ...eventsResponse.result,
      ]);
      const parentSpansResponse = refreshTokenParentIds.length === 0
        ? null
        : await adminApp.queryAnalytics({
          query: SPANS_BY_ID_QUERY,
          params: { spanIds: refreshTokenParentIds },
          include_all_branches: false,
          timeout_ms: 30000,
        });
      if (seq !== requestSeqRef.current) return;
      setSpans(parseUniqueSpanRows([
        ...spansResponse.result,
        ...refreshTokenRootsResponse.result,
        ...(parentSpansResponse?.result ?? []),
      ]));
      setEvents(eventsResponse.result.map(parseEventRow).filter((event): event is EventInput => event != null));
      setNowMs(Date.now());
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [adminApp, hours]);

  const lastAutomaticLoadRef = useRef<{ adminApp: typeof adminApp, hours: number } | null>(null);
  useEffect(() => {
    const lastLoad = lastAutomaticLoadRef.current;
    if (lastLoad?.adminApp === adminApp && lastLoad.hours === hours) return;
    lastAutomaticLoadRef.current = { adminApp, hours };
    runAsynchronouslyWithAlert(loadData);
  }, [adminApp, hours, loadData]);

  const scopedSpans = useMemo(
    () => (scope === "custom" ? spans.filter((span) => !isSystemSpanType(span.spanType)) : spans),
    [spans, scope],
  );
  const scopedEvents = useMemo(
    () => (scope === "custom" ? events.filter((event) => !event.eventType.startsWith("$")) : events),
    [events, scope],
  );

  const { traces } = useMemo(() => buildTraces(scopedSpans, scopedEvents), [scopedSpans, scopedEvents]);

  const searchNeedle = search.trim().toLowerCase();
  const filteredTraces = useMemo(() => {
    if (searchNeedle === "") return traces;
    return traces.filter((trace) => subtreeMatches(trace.root, searchNeedle));
  }, [traces, searchNeedle]);

  const selectedTrace = useMemo<Trace | null>(
    () => filteredTraces.find((trace) => trace.root.span.id === selectedRootId)
      ?? (filteredTraces.length > 0 ? filteredTraces[0] : null),
    [filteredTraces, selectedRootId],
  );

  // Focus mode: view any span inside the selected trace as its own trace,
  // re-scaled to the subtree. A stale/foreign id falls back to the full trace.
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null);
  const displayedTrace = useMemo<{ trace: Trace, breadcrumb: TraceBreadcrumb[] } | null>(() => {
    if (selectedTrace == null) return null;
    if (focusedSpanId != null && focusedSpanId !== selectedTrace.root.span.id) {
      const rerooted = rerootTrace(selectedTrace, focusedSpanId);
      if (rerooted != null) {
        return {
          trace: rerooted.trace,
          breadcrumb: rerooted.path.slice(0, -1).map((node) => ({ spanId: node.span.id, spanType: node.span.spanType })),
        };
      }
    }
    return { trace: selectedTrace, breadcrumb: [] };
  }, [selectedTrace, focusedSpanId]);

  const openDetail = useCallback((raw: Record<string, unknown>) => {
    setDetailRow(raw);
  }, []);

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth>
        {/* StickyPageHeader's sentinel uses -mb-[17px]; compensate so this dense page keeps matching top/side gutters. */}
        <div
          className="flex flex-col pt-[17px] [--header-sticky-top:4.25rem] dark:[--header-sticky-top:5.75rem]"
        >
          <StickyPageHeader
            title="Traces"
            sticky
            layoutGroupId="traces-sticky-header"
            actions={
              <TooltipProvider>
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    value={scope}
                    onChange={(value) => setScope(value)}
                    options={[{ label: "All", value: "all" as const }, { label: "Custom", value: "custom" as const }]}
                  />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by span or event type…"
                    className="h-8 w-56 text-xs"
                  />
                  <div className="flex items-center gap-1 whitespace-nowrap text-xs">
                    <HeaderCountStat icon={<TreeStructureIcon className="h-3.5 w-3.5" />} value={filteredTraces.length} label={`${filteredTraces.length.toLocaleString()} ${filteredTraces.length === 1 ? "trace" : "traces"}`} />
                    <HeaderCountStat icon={<StackIcon className="h-3.5 w-3.5" />} value={scopedSpans.length} label={`${scopedSpans.length.toLocaleString()} ${scopedSpans.length === 1 ? "span" : "spans"}`} />
                    <HeaderCountStat icon={<ChartLineIcon className="h-3.5 w-3.5" />} value={scopedEvents.length} label={`${scopedEvents.length.toLocaleString()} ${scopedEvents.length === 1 ? "event" : "events"}`} />
                  </div>
                  <Segmented value={hours} onChange={setHours} options={TIME_RANGES.map((range) => ({ label: range.label, value: range.hours }))} />
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => runAsynchronouslyWithAlert(loadData)}
                  >
                    <ArrowClockwiseIcon className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </TooltipProvider>
            }
          />

          <div className="mt-2 empty:hidden">
            <AnalyticsEventLimitBanner />
          </div>

          <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Trace list: on desktop it scrolls with the waterfall until it
                reaches the page's sticky top edge, then scrolls internally if
                taller than the viewport. On narrow screens it stacks above
                the waterfall with a capped height. */}
            <div
              className={cn(
                CARD_CLASSES,
                "flex w-full flex-col overflow-hidden max-h-[45dvh]",
                "lg:sticky lg:top-[var(--header-sticky-top)] lg:w-80 lg:shrink-0",
                "lg:max-h-[calc(100dvh-var(--header-sticky-top)-0.75rem)]",
              )}
            >
              <div className="px-4 py-3 border-b border-border/50 shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Traces</span>
              </div>
              <div className="min-h-0 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center py-16">
                    <SpinnerGapIcon className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!loading && error != null && (
                  <ErrorDisplay error={error} onRetry={loadData} />
                )}
                {!loading && error == null && filteredTraces.length === 0 && (
                  <EmptyState title={search.trim() !== "" ? "No traces match the filter." : "No spans in this time range."}>
                    {search.trim() === "" && (
                      <pre className="text-left font-mono text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-auto max-w-full">
                        {`const span = app.startSpan("checkout");\nawait span.trackEvent("item_added",\n  { sku: "T-100" });\nawait span.end();`}
                      </pre>
                    )}
                  </EmptyState>
                )}
                {!loading && error == null && filteredTraces.length > 0 && (
                  <SpanTreeList
                    traces={filteredTraces}
                    nowMs={nowMs}
                    needle={searchNeedle}
                    activeSpanId={displayedTrace?.trace.root.span.id ?? null}
                    onSelectSpan={(rootId, spanId) => {
                      setSelectedRootId(rootId);
                      setFocusedSpanId(spanId === rootId ? null : spanId);
                    }}
                  />
                )}
              </div>
            </div>

            {/* Waterfall: grows with its rows so the page scrolls; deep rows
                slide up behind the floating header pill, like the overview. */}
            <div className={cn(CARD_CLASSES, "flex-1 min-w-0 flex flex-col min-h-[420px] overflow-hidden")}>
              {loading && (
                <div className="flex flex-1 items-center justify-center py-24">
                  <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && error == null && displayedTrace == null && (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState title="Select a trace to see its waterfall." />
                </div>
              )}
              {!loading && error == null && displayedTrace != null && (
                <TraceWaterfall
                  trace={displayedTrace.trace}
                  nowMs={nowMs}
                  breadcrumb={displayedTrace.breadcrumb}
                  onFocusSpan={(spanId) => setFocusedSpanId(spanId)}
                  onSelectSpan={(span) => openDetail(span.raw)}
                  onSelectEvent={(event) => openDetail(event.raw)}
                />
              )}
              {!loading && error != null && (
                <div className="flex flex-1 items-center justify-center py-24">
                  <ErrorDisplay error={error} onRetry={loadData} />
                </div>
              )}
            </div>
          </div>
        </div>

        <RowDetailDialog
          row={detailRow}
          columns={detailRow != null ? Object.keys(detailRow) : []}
          open={detailRow != null}
          onOpenChange={(open) => {
            if (!open) setDetailRow(null);
          }}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
