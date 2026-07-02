"use client";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretRightIcon, CornersOutIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { flattenTrace, formatDuration, isSystemSpanType, type EventInput, type SpanInput, type Trace } from "./trace-utils";

const SPAN_COLOR_CLASSES = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-fuchsia-500",
];

/** Stable color per span type so the same operation looks the same across traces. */
export function spanColorClass(spanType: string): string {
  if (isSystemSpanType(spanType)) return "bg-slate-400/80 dark:bg-slate-500/80";
  let hash = 0;
  for (let i = 0; i < spanType.length; i++) {
    hash = (hash * 31 + spanType.charCodeAt(i)) | 0;
  }
  return SPAN_COLOR_CLASSES[Math.abs(hash) % SPAN_COLOR_CLASSES.length];
}

const NAME_COLUMN = "minmax(200px, 260px)";
const DURATION_COLUMN = "76px";

export type TraceBreadcrumb = { spanId: string, spanType: string };

export function TraceWaterfall({
  trace,
  breadcrumb,
  onFocusSpan,
  onSelectSpan,
  onSelectEvent,
}: {
  trace: Trace,
  /** Ancestors of the current view root (trace root first); empty when unfocused. */
  breadcrumb: TraceBreadcrumb[],
  onFocusSpan: (spanId: string) => void,
  onSelectSpan: (span: SpanInput) => void,
  onSelectEvent: (event: EventInput) => void,
}) {
  const rows = useMemo(() => flattenTrace(trace), [trace]);

  // Open traces render to the latest observed timestamp; open bars are drawn
  // to the right edge with a fade, so the horizon only needs to be sane, not
  // exact. The epsilon keeps zero-length traces from dividing by zero.
  const scaleStart = trace.startMs;
  const scaleEnd = Math.max(trace.endMs ?? trace.latestMs, scaleStart + 1);
  const scaleSpan = scaleEnd - scaleStart;
  const toPct = (ms: number) => Math.min(100, Math.max(0, ((ms - scaleStart) / scaleSpan) * 100));

  const gridTemplateColumns = `${NAME_COLUMN} 1fr ${DURATION_COLUMN}`;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Trace header */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border/50 shrink-0 min-w-0">
        {breadcrumb.map((crumb) => (
          <span key={crumb.spanId} className="flex items-center gap-1.5 min-w-0 shrink">
            <button
              className="font-mono text-xs text-muted-foreground hover:text-foreground truncate transition-colors hover:transition-none"
              onClick={() => onFocusSpan(crumb.spanId)}
              title={`Focus ${crumb.spanType}`}
            >
              {crumb.spanType}
            </button>
            <CaretRightIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          </span>
        ))}
        <span className="font-mono text-sm font-semibold truncate">{trace.root.span.spanType}</span>
        {trace.endMs == null ? (
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">open</Badge>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">{formatDuration(trace.endMs - trace.startMs)}</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {trace.spanCount} {trace.spanCount === 1 ? "span" : "spans"} · {trace.eventCount} {trace.eventCount === 1 ? "event" : "events"} · started {new Date(trace.startMs).toLocaleString()}
        </span>
      </div>

      {/* Time ruler */}
      <div className="grid gap-3 px-4 py-1.5 border-b border-border/30 shrink-0" style={{ gridTemplateColumns }}>
        <span className="font-mono text-[10px] text-muted-foreground">name</span>
        <div className="relative h-4">
          {[0, 25, 50, 75, 100].map((pct) => (
            <span
              key={pct}
              className={cn(
                "absolute top-0 font-mono text-[10px] text-muted-foreground/70",
                pct === 100 ? "-translate-x-full" : pct === 0 ? "" : "-translate-x-1/2",
              )}
              style={{ left: `${pct}%` }}
            >
              {formatDuration((scaleSpan * pct) / 100)}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground text-right">duration</span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-auto">
        {rows.map((row, index) => {
          if (row.kind === "span") {
            const { span } = row.node;
            const open = span.endMs == null;
            const isViewRoot = row.node.depth === 0;
            const leftPct = toPct(span.startMs);
            const rightPct = open ? 100 : toPct(span.endMs ?? scaleEnd);
            const widthPct = Math.max(rightPct - leftPct, 0.5);
            return (
              <div
                key={`span-${span.id}-${index}`}
                className="group w-full grid gap-3 px-4 items-center h-8 border-b border-border/20 hover:bg-muted/30 transition-colors hover:transition-none text-left cursor-pointer"
                style={{ gridTemplateColumns }}
                onClick={() => onSelectSpan(span)}
              >
                <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${row.node.depth * 14}px` }}>
                  <span className={cn("h-2 w-2 rounded-[3px] shrink-0", spanColorClass(span.spanType))} />
                  <span className={cn("font-mono text-[11px] truncate", isSystemSpanType(span.spanType) ? "text-muted-foreground" : "font-medium")}>
                    {span.spanType}
                  </span>
                  {!isViewRoot && (
                    <button
                      className="opacity-0 group-hover:opacity-100 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-opacity"
                      title="Focus this span"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocusSpan(span.id);
                      }}
                    >
                      <CornersOutIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="relative h-4">
                  {[25, 50, 75].map((pct) => (
                    <span key={pct} className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${pct}%` }} />
                  ))}
                  <span
                    className={cn(
                      "absolute inset-y-0.5 rounded-sm",
                      spanColorClass(span.spanType),
                      open && "[mask-image:linear-gradient(to_right,black_60%,transparent_100%)]",
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "3px" }}
                  />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground text-right">
                  {open ? "open" : formatDuration((span.endMs ?? scaleEnd) - span.startMs)}
                </span>
              </div>
            );
          } else {
            const { event } = row;
            const leftPct = toPct(event.atMs);
            return (
              <div
                key={`event-${index}`}
                className="w-full grid gap-3 px-4 items-center h-7 border-b border-border/20 hover:bg-muted/30 transition-colors hover:transition-none text-left cursor-pointer"
                style={{ gridTemplateColumns }}
                onClick={() => onSelectEvent(event)}
              >
                <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${row.depth * 14}px` }}>
                  <span className="h-1.5 w-1.5 rotate-45 bg-foreground/50 shrink-0" />
                  <span className="font-mono text-[11px] text-muted-foreground truncate">{event.eventType}</span>
                </div>
                <div className="relative h-4">
                  {[25, 50, 75].map((pct) => (
                    <span key={pct} className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${pct}%` }} />
                  ))}
                  <span
                    className="absolute top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rotate-45 rounded-[2px] bg-foreground/60"
                    style={{ left: `${leftPct}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground/70 text-right">
                  +{formatDuration(event.atMs - scaleStart)}
                </span>
              </div>
            );
          }
        })}
      </div>
    </div>
  );
}
