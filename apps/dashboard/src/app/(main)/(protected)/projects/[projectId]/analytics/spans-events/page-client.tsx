"use client";

import { Badge, Button, Input, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  AnalyticsEventLimitBanner,
  ErrorDisplay,
  RowDetailDialog,
  VirtualizedFlatTable,
  isDateValue,
  parseClickHouseDate,
  type RowData,
} from "../shared";
import {
  buildTraces,
  formatDuration,
  isSystemSpanType,
  type EventInput,
  type SpanInput,
  type Trace,
} from "./trace-utils";
import { TraceWaterfall, spanColorClass } from "./waterfall";

const SPANS_QUERY = `
SELECT id, span_type, span_started_at, span_ended_at, parent_span_ids, data,
       user_id, refresh_token_id, session_replay_id, session_replay_segment_id
FROM default.spans
WHERE span_started_at >= now64(3) - INTERVAL {hours:UInt32} HOUR
ORDER BY span_started_at DESC
LIMIT 3000
`;

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

const EVENT_TABLE_COLUMNS = ["event_type", "event_at", "user_id", "parent_span_ids", "data"];

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

function parseEventRow(row: Record<string, unknown>): EventInput | null {
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
    raw: row,
  };
}

function traceMatchesSearch(trace: Trace, needle: string): boolean {
  const walk = (node: Trace["root"]): boolean => {
    if (node.span.spanType.toLowerCase().includes(needle)) return true;
    if (node.events.some((event) => event.eventType.toLowerCase().includes(needle))) return true;
    return node.children.some(walk);
  };
  return walk(trace.root);
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
              ? "bg-background shadow-sm text-foreground"
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
    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
      <Typography variant="secondary" className="text-sm font-medium">{title}</Typography>
      {children}
    </div>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();

  const [hours, setHours] = useState<number>(24);
  const [tab, setTab] = useState<"traces" | "events">("traces");
  const [scope, setScope] = useState<"custom" | "all">("custom");
  const [search, setSearch] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);

  const [spans, setSpans] = useState<SpanInput[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [spansResponse, eventsResponse] = await Promise.all([
        adminApp.queryAnalytics({
          query: SPANS_QUERY,
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
      ]);
      if (seq !== requestSeqRef.current) return;
      setSpans(spansResponse.result.map(parseSpanRow).filter((span): span is SpanInput => span != null));
      setEvents(eventsResponse.result.map(parseEventRow).filter((event): event is EventInput => event != null));
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [adminApp, hours]);

  const lastLoadedHoursRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastLoadedHoursRef.current === hours) return;
    lastLoadedHoursRef.current = hours;
    runAsynchronouslyWithAlert(loadData);
  }, [hours, loadData]);

  const scopedSpans = useMemo(
    () => (scope === "custom" ? spans.filter((span) => !isSystemSpanType(span.spanType)) : spans),
    [spans, scope],
  );
  const scopedEvents = useMemo(
    () => (scope === "custom" ? events.filter((event) => !event.eventType.startsWith("$")) : events),
    [events, scope],
  );

  const { traces } = useMemo(() => buildTraces(scopedSpans, scopedEvents), [scopedSpans, scopedEvents]);

  const filteredTraces = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return traces;
    return traces.filter((trace) => traceMatchesSearch(trace, needle));
  }, [traces, search]);

  const selectedTrace = useMemo<Trace | null>(
    () => filteredTraces.find((trace) => trace.root.span.id === selectedRootId)
      ?? (filteredTraces.length > 0 ? filteredTraces[0] : null),
    [filteredTraces, selectedRootId],
  );

  const eventTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of scopedEvents) {
      counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopedEvents]);

  const tableEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scopedEvents.filter((event) =>
      (eventTypeFilter == null || event.eventType === eventTypeFilter)
      && (needle === "" || event.eventType.toLowerCase().includes(needle)),
    );
  }, [scopedEvents, eventTypeFilter, search]);

  const openDetail = useCallback((raw: Record<string, unknown>) => {
    setDetailRow(raw);
  }, []);

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Spans & Events"
        description="Custom spans and events from the SDK, correlated into traces."
        fillWidth
        containedHeight
        actions={
          <div className="flex items-center gap-2">
            <Segmented value={hours} onChange={setHours} options={TIME_RANGES.map((range) => ({ label: range.label, value: range.hours }))} />
            <Button
              className="gap-1.5"
              variant="secondary"
              disabled={loading}
              onClick={() => runAsynchronouslyWithAlert(loadData)}
            >
              <ArrowClockwiseIcon className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      >
        <AnalyticsEventLimitBanner />

        {/* Tab + filter bar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Segmented
            value={tab}
            onChange={(value) => setTab(value)}
            options={[{ label: "Traces", value: "traces" as const }, { label: "Events", value: "events" as const }]}
          />
          <Segmented
            value={scope}
            onChange={(value) => setScope(value)}
            options={[{ label: "Custom", value: "custom" as const }, { label: "All (incl. system)", value: "all" as const }]}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "traces" ? "Filter by span or event type…" : "Filter by event type…"}
            className="h-8 w-56 text-xs"
          />
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredTraces.length} {filteredTraces.length === 1 ? "trace" : "traces"} · {scopedSpans.length} {scopedSpans.length === 1 ? "span" : "spans"} · {scopedEvents.length} {scopedEvents.length === 1 ? "event" : "events"}
          </span>
        </div>

        {tab === "traces" ? (
          <div className="flex-1 min-h-0 flex gap-4">
            {/* Trace list */}
            <div className={cn(CARD_CLASSES, "w-80 shrink-0 flex flex-col min-h-0 overflow-hidden")}>
              <div className="px-3 py-2 border-b border-border/50 shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Traces</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {loading && (
                  <div className="flex items-center justify-center h-full">
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
                {!loading && error == null && filteredTraces.map((trace) => {
                  const isSelected = selectedTrace != null && trace.root.span.id === selectedTrace.root.span.id;
                  const open = trace.endMs == null;
                  return (
                    <button
                      key={trace.root.span.id}
                      className={cn(
                        "w-full text-left px-3 py-2 border-b border-border/30 hover:bg-muted/30 transition-colors hover:transition-none",
                        isSelected && "bg-muted/50 hover:bg-muted/50",
                      )}
                      onClick={() => setSelectedRootId(trace.root.span.id)}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("h-2 w-2 rounded-[3px] shrink-0", spanColorClass(trace.root.span.spanType))} />
                        <span className="font-mono text-xs font-semibold truncate">{trace.root.span.spanType}</span>
                        {open ? (
                          <Badge variant="secondary" className="ml-auto text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 shrink-0">open</Badge>
                        ) : (
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground shrink-0">{formatDuration((trace.endMs ?? trace.latestMs) - trace.startMs)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span className="truncate">{new Date(trace.startMs).toLocaleString()}</span>
                        <span className="ml-auto shrink-0">{trace.spanCount}s · {trace.eventCount}e</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Waterfall */}
            <div className={cn(CARD_CLASSES, "flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden")}>
              {loading && (
                <div className="flex items-center justify-center h-full">
                  <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && error == null && selectedTrace == null && (
                <EmptyState title="Select a trace to see its waterfall." />
              )}
              {!loading && error == null && selectedTrace != null && (
                <TraceWaterfall
                  trace={selectedTrace}
                  onSelectSpan={(span) => openDetail(span.raw)}
                  onSelectEvent={(event) => openDetail(event.raw)}
                />
              )}
              {!loading && error != null && (
                <div className="flex items-center justify-center h-full">
                  <ErrorDisplay error={error} onRetry={loadData} />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={cn(CARD_CLASSES, "flex-1 min-h-0 flex flex-col overflow-hidden")}>
            {/* Event type breakdown chips */}
            {eventTypeCounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/50 shrink-0">
                {eventTypeCounts.slice(0, 12).map(([eventType, count]) => (
                  <button
                    key={eventType}
                    onClick={() => setEventTypeFilter(eventTypeFilter === eventType ? null : eventType)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-mono transition-colors hover:transition-none",
                      eventTypeFilter === eventType
                        ? "border-foreground/30 bg-foreground/[0.08] text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40",
                    )}
                  >
                    <span>{eventType}</span>
                    <span className="font-semibold">{count}</span>
                  </button>
                ))}
                {eventTypeFilter != null && (
                  <button
                    onClick={() => setEventTypeFilter(null)}
                    className="px-2 py-0.5 rounded-full text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center h-full">
                <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && error != null && (
              <div className="flex items-center justify-center h-full">
                <ErrorDisplay error={error} onRetry={loadData} />
              </div>
            )}
            {!loading && error == null && tableEvents.length === 0 && (
              <EmptyState title="No events in this time range.">
                <pre className="text-left font-mono text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-auto max-w-full">
                  {`await app.trackEvent("signup_completed",\n  { plan: "pro" });`}
                </pre>
              </EmptyState>
            )}
            {!loading && error == null && tableEvents.length > 0 && (
              <VirtualizedFlatTable
                columns={EVENT_TABLE_COLUMNS}
                rows={tableEvents.map((event) => event.raw)}
                onRowClick={(row) => openDetail(row)}
              />
            )}
          </div>
        )}

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
