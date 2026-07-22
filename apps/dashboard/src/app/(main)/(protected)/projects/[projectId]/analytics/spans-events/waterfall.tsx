"use client";

import { Badge, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretRightIcon, ChartLineIcon, ClockIcon, CornersOutIcon, KeyboardIcon, StackIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDuration,
  getTraceScaleEnd,
  isSystemSpanType,
  panViewWindow,
  zoomViewWindow,
  type EventInput,
  type SpanInput,
  type Trace,
  type TraceNode,
  type ViewWindow,
  type WaterfallRow,
} from "./trace-utils";

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
const FULL_VIEW: ViewWindow = { start: 0, end: 1 };

export type TraceBreadcrumb = { spanId: string, spanType: string };

type DragSelection = {
  anchor: number,
  current: number,
};

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function timelineFraction(clientX: number, rect: { left: number, width: number }): number {
  if (rect.width <= 0) return 0;
  return clampUnit((clientX - rect.left) / rect.width);
}

function collectSubtreeSpanIds(node: TraceNode): string[] {
  return [
    node.span.id,
    ...node.children.flatMap(collectSubtreeSpanIds),
  ];
}

function flattenVisibleTrace(trace: Trace, collapsedSpanIds: Set<string>): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  const walk = (node: TraceNode) => {
    rows.push({ kind: "span", node });
    if (collapsedSpanIds.has(node.span.id)) return;
    const items: { atMs: number, row: () => void }[] = [
      ...node.events.map((event) => ({ atMs: event.atMs, row: () => rows.push({ kind: "event", event, depth: node.depth + 1 }) })),
      ...node.children.map((child) => ({ atMs: child.span.startMs, row: () => walk(child) })),
    ];
    items.sort((a, b) => a.atMs - b.atMs);
    for (const item of items) item.row();
  };
  walk(trace.root);
  return rows;
}

function TimelineGridlines() {
  return (
    <>
      {[25, 50, 75].map((pct) => (
        <span key={pct} className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${pct}%` }} />
      ))}
    </>
  );
}

function DragSelectionOverlay({ selection }: { selection: DragSelection | null }) {
  if (selection == null) return null;
  const left = Math.min(selection.anchor, selection.current) * 100;
  const width = Math.abs(selection.current - selection.anchor) * 100;
  return (
    <span
      className="pointer-events-none absolute inset-y-0 rounded-sm border border-blue-500/70 bg-blue-500/15"
      style={{ left: `${left}%`, width: `${width}%` }}
    />
  );
}

function TraceHeaderStat({ icon, value, label }: { icon: React.ReactNode, value: number | string, label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground">
          {icon}
          <span className="font-mono text-[11px]">{value}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TraceWaterfall({
  trace,
  nowMs,
  breadcrumb,
  onFocusSpan,
  onSelectSpan,
  onSelectEvent,
}: {
  trace: Trace,
  /** "Current time" reference (when the data was loaded): the timeline never scales past it. */
  nowMs: number,
  /** Ancestors of the current view root (trace root first); empty when unfocused. */
  breadcrumb: TraceBreadcrumb[],
  onFocusSpan: (spanId: string) => void,
  onSelectSpan: (span: SpanInput) => void,
  onSelectEvent: (event: EventInput) => void,
}) {
  const [collapsedSpanIds, setCollapsedSpanIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => flattenVisibleTrace(trace, collapsedSpanIds), [trace, collapsedSpanIds]);

  const [view, setView] = useState<ViewWindow>(FULL_VIEW);
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const rootSpanId = trace.root.span.id;
  useEffect(() => {
    setView(FULL_VIEW);
    setCollapsedSpanIds(new Set());
  }, [rootSpanId]);

  // The scale is clamped to "now": a $refresh-token's expiry a year out must
  // not compress everything that actually happened into a sliver. Future
  // interval ends render as a fading stub instead. The epsilon keeps
  // zero-length traces from dividing by zero.
  const scaleStart = trace.startMs;
  const scaleEnd = getTraceScaleEnd(trace, nowMs);
  const totalSpanMs = scaleEnd - scaleStart;
  const viewStartMs = scaleStart + view.start * totalSpanMs;
  const viewSpanMs = Math.max((view.end - view.start) * totalSpanMs, 1e-9);
  const toPct = (ms: number) => ((ms - viewStartMs) / viewSpanMs) * 100;
  const isZoomed = view.start > 0 || view.end < 1;

  // cmd/ctrl+scroll zooms around the cursor; horizontal scroll pans while
  // zoomed. Attached non-passively so preventDefault stops page zoom/scroll.
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (container == null) return;
    const handleWheel = (e: WheelEvent) => {
      const track = trackRef.current;
      if (track == null) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const current = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchorFrac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
        // Functional update: wheel events can arrive faster than re-renders,
        // and each step must compound on the previous one.
        setView((prev) => zoomViewWindow(prev, anchorFrac, Math.exp(e.deltaY * 0.01)));
      } else if ((current.start > 0 || current.end < 1) && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        setView((prev) => panViewWindow(prev, e.deltaX / rect.width));
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => () => {
    dragCleanupRef.current?.();
  }, []);

  const startTimelineDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = timelineFraction(event.clientX, rect);
    setDragSelection({ anchor, current: anchor });
    dragCleanupRef.current?.();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setDragSelection({ anchor, current: timelineFraction(moveEvent.clientX, rect) });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      dragCleanupRef.current = null;
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanup();
      const current = timelineFraction(upEvent.clientX, rect);
      setDragSelection(null);
      const start = Math.min(anchor, current);
      const end = Math.max(anchor, current);
      if (end - start < 0.015) return;
      setView((prev) => {
        const span = prev.end - prev.start;
        return {
          start: prev.start + start * span,
          end: prev.start + end * span,
        };
      });
    };
    const handlePointerCancel = () => {
      cleanup();
      setDragSelection(null);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  };

  const toggleCollapsed = (node: TraceNode, recursive: boolean) => {
    setCollapsedSpanIds((prev) => {
      const next = new Set(prev);
      const shouldCollapse = !next.has(node.span.id);
      const ids = recursive ? collectSubtreeSpanIds(node) : [node.span.id];
      for (const id of ids) {
        if (shouldCollapse) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const gridTemplateColumns = `${NAME_COLUMN} 1fr ${DURATION_COLUMN}`;

  return (
    <TooltipProvider>
      <div ref={containerRef} className="flex flex-col flex-1">
        <div>
          {/* Trace header */}
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border/50 min-w-0">
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
            ) : trace.endMs > nowMs ? (
              <span className="font-mono text-xs text-muted-foreground" title={`Ends ${new Date(trace.endMs).toLocaleString()}`}>
                {formatDuration(nowMs - trace.startMs)} →
              </span>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{formatDuration(trace.endMs - trace.startMs)}</span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1 text-xs">
              <TraceHeaderStat icon={<StackIcon className="h-3.5 w-3.5" />} value={trace.spanCount} label={`${trace.spanCount} ${trace.spanCount === 1 ? "span" : "spans"}`} />
              <TraceHeaderStat icon={<ChartLineIcon className="h-3.5 w-3.5" />} value={trace.eventCount} label={`${trace.eventCount} ${trace.eventCount === 1 ? "event" : "events"}`} />
              <TraceHeaderStat icon={<ClockIcon className="h-3.5 w-3.5" />} value={new Date(trace.startMs).toLocaleTimeString()} label={`Started ${new Date(trace.startMs).toLocaleString()}`} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center rounded p-1 text-muted-foreground">
                    <KeyboardIcon className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono leading-relaxed">
                  <div>Drag timeline: zoom to range</div>
                  <div>Cmd/Ctrl + scroll: zoom</div>
                  <div>Horizontal scroll: pan</div>
                  <div>Option/Alt + caret: collapse subtree</div>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Time ruler */}
          <div className="grid gap-3 px-4 py-1.5 border-b border-border/30 shrink-0" style={{ gridTemplateColumns }}>
            <span className="font-mono text-[10px] text-muted-foreground">name</span>
            <div
              ref={trackRef}
              className="relative h-4 cursor-ew-resize"
              onPointerDown={startTimelineDrag}
              onClick={(e) => e.stopPropagation()}
            >
              <DragSelectionOverlay selection={dragSelection} />
              {[0, 25, 50, 75, 100].map((pct) => (
                <span
                  key={pct}
                  className={cn(
                "absolute top-0 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap",
                pct === 100 ? "-translate-x-full" : pct === 0 ? "" : "-translate-x-1/2",
              )}
                  style={{ left: `${pct}%` }}
                >
                  {formatDuration((viewStartMs - scaleStart) + (viewSpanMs * pct) / 100)}
                </span>
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground text-right">
              {isZoomed ? (
                <button
                  className="rounded px-1 text-foreground/80 hover:text-foreground hover:bg-foreground/[0.08]"
                  onClick={() => setView(FULL_VIEW)}
                  title="Reset zoom"
                >
                  reset
                </button>
              ) : (
                "duration"
              )}
            </span>
          </div>
        </div>

        {/* Rows */}
        <div>
          {rows.map((row, index) => {
            if (row.kind === "span") {
              const { span } = row.node;
              const hasChildren = row.node.children.length > 0 || row.node.events.length > 0;
              const collapsed = collapsedSpanIds.has(span.id);
              const open = span.endMs == null;
              const runsIntoFuture = !open && (span.endMs ?? 0) > nowMs;
              const isViewRoot = row.node.depth === 0;
              const barEndMs = open || runsIntoFuture ? Math.min(nowMs, scaleEnd + viewSpanMs) : (span.endMs ?? scaleEnd);
              const rawLeftPct = toPct(span.startMs);
              const rawRightPct = toPct(barEndMs);
              const barVisible = rawRightPct > 0 && rawLeftPct < 100;
              const leftPct = Math.max(rawLeftPct, 0);
              const rightPct = Math.min(rawRightPct, 100);
              const widthPct = Math.max(rightPct - leftPct, 0.4);
              const fades = open || runsIntoFuture;
              return (
                <div
                  key={`span-${span.id}-${index}`}
                  className="group w-full grid gap-3 px-4 items-center h-8 border-b border-border/20 hover:bg-muted/30 transition-colors hover:transition-none text-left cursor-pointer"
                  style={{ gridTemplateColumns }}
                  onClick={() => onSelectSpan(span)}
                >
                  <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${row.node.depth * 14}px` }}>
                    {hasChildren ? (
                      <button
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                        title={collapsed ? "Expand" : "Collapse"}
                        aria-expanded={!collapsed}
                        onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(row.node, e.altKey);
                        }}
                      >
                        <CaretRightIcon className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")} />
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
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
                  <div className="relative h-4 cursor-ew-resize" onPointerDown={startTimelineDrag} onClick={(e) => e.stopPropagation()}>
                    <TimelineGridlines />
                    <DragSelectionOverlay selection={dragSelection} />
                    {barVisible && (
                      <span
                        className={cn(
                        "absolute inset-y-0.5 rounded-sm",
                        spanColorClass(span.spanType),
                        fades && "[mask-image:linear-gradient(to_right,black_60%,transparent_100%)]",
                      )}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "3px" }}
                        title={runsIntoFuture ? `Ends ${new Date(span.endMs ?? 0).toLocaleString()}` : undefined}
                      />
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground text-right">
                    {open
                      ? "open"
                      : runsIntoFuture
                        ? <span title={`Ends ${new Date(span.endMs ?? 0).toLocaleString()}`}>{formatDuration(nowMs - span.startMs)} →</span>
                        : formatDuration((span.endMs ?? scaleEnd) - span.startMs)}
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
                  <div className="relative h-4 cursor-ew-resize" onPointerDown={startTimelineDrag} onClick={(e) => e.stopPropagation()}>
                    <TimelineGridlines />
                    <DragSelectionOverlay selection={dragSelection} />
                    {leftPct >= 0 && leftPct <= 100 && (
                      <span
                        className="absolute top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rotate-45 rounded-[2px] bg-foreground/60"
                        style={{ left: `${leftPct}%` }}
                      />
                    )}
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
    </TooltipProvider>
  );
}
