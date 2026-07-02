"use client";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatDuration, subtreeMatches, type Trace, type TraceNode } from "./trace-utils";
import { spanColorClass } from "./waterfall";

// Nodes shallower than this render expanded unless the user collapsed them.
const DEFAULT_EXPANDED_DEPTH = 3;

function nodeMatches(node: TraceNode, needle: string): boolean {
  return node.span.spanType.toLowerCase().includes(needle)
    || node.events.some((event) => event.eventType.toLowerCase().includes(needle));
}

function DurationLabel({ startMs, endMs, nowMs }: { startMs: number, endMs: number | null, nowMs: number }) {
  if (endMs == null) {
    return <Badge variant="secondary" className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">open</Badge>;
  }
  if (endMs > nowMs) {
    // Interval reaches into the future (e.g. $refresh-token runs until its
    // expiry) — show elapsed-so-far instead of the misleading total.
    return (
      <span
        className="font-mono text-[11px] text-muted-foreground"
        title={`Ends ${new Date(endMs).toLocaleString()}`}
      >
        {formatDuration(nowMs - startMs)} →
      </span>
    );
  }
  return <span className="font-mono text-[11px] text-muted-foreground">{formatDuration(endMs - startMs)}</span>;
}

function TreeNode({
  node,
  trace,
  nowMs,
  needle,
  activeSpanId,
  expandedOverrides,
  onToggle,
  onSelectSpan,
}: {
  node: TraceNode,
  trace: Trace,
  nowMs: number,
  needle: string,
  activeSpanId: string | null,
  expandedOverrides: Record<string, boolean>,
  onToggle: (spanId: string) => void,
  onSelectSpan: (rootId: string, spanId: string) => void,
}) {
  const isSearching = needle !== "";
  const visibleChildren = isSearching
    ? node.children.filter((child) => subtreeMatches(child, needle))
    : node.children;
  const hasChildren = visibleChildren.length > 0;
  const expanded = expandedOverrides[node.span.id]
    ?? (isSearching ? hasChildren : node.depth < DEFAULT_EXPANDED_DEPTH);
  const isActive = node.span.id === activeSpanId;
  const isRoot = node.depth === 0;

  return (
    <>
      <div
        className={cn(
          "w-full flex items-center gap-1 pr-3 py-1.5 border-b border-border/20 hover:bg-muted/30 transition-colors hover:transition-none cursor-pointer min-w-0",
          isActive && "bg-muted/50 hover:bg-muted/50",
        )}
        style={{ paddingLeft: `${8 + node.depth * 12}px` }}
        onClick={() => onSelectSpan(trace.root.span.id, node.span.id)}
      >
        {hasChildren ? (
          <button
            className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            title={expanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.span.id);
            }}
          >
            <CaretRightIcon className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={cn("h-2 w-2 rounded-[3px] shrink-0", spanColorClass(node.span.spanType))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "font-mono text-xs truncate",
                isRoot ? "font-semibold" : "font-medium",
                isSearching && nodeMatches(node, needle) && "rounded bg-amber-500/15 px-0.5",
              )}
            >
              {node.span.spanType}
            </span>
            <span className="ml-auto shrink-0">
              {/* Root rows represent the whole trace, so they show trace
                  bounds — a derived $refresh-token span's own start can move
                  forward on token rotation and would read nonsensically. */}
              <DurationLabel
                startMs={isRoot ? trace.startMs : node.span.startMs}
                endMs={isRoot ? trace.endMs : node.span.endMs}
                nowMs={nowMs}
              />
            </span>
          </div>
          {isRoot && (
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
              <span className="truncate">{new Date(trace.startMs).toLocaleString()}</span>
              <span className="ml-auto shrink-0">{trace.spanCount}s · {trace.eventCount}e</span>
            </div>
          )}
        </div>
      </div>
      {expanded && visibleChildren.map((child) => (
        <TreeNode
          key={child.span.id}
          node={child}
          trace={trace}
          nowMs={nowMs}
          needle={needle}
          activeSpanId={activeSpanId}
          expandedOverrides={expandedOverrides}
          onToggle={onToggle}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </>
  );
}

/**
 * Hierarchical trace list: every span in every trace is reachable and
 * individually selectable (selection focuses it in the waterfall). The first
 * levels render expanded; deeper levels collapse behind carets. While
 * searching, only matching subtrees render and ancestors force-expand.
 */
export function SpanTreeList({
  traces,
  nowMs,
  needle,
  activeSpanId,
  onSelectSpan,
}: {
  traces: Trace[],
  nowMs: number,
  needle: string,
  /** The span id currently shown as the waterfall root. */
  activeSpanId: string | null,
  onSelectSpan: (rootId: string, spanId: string) => void,
}) {
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});

  const handleToggle = (spanId: string) => {
    setExpandedOverrides((prev) => {
      const isSearching = needle !== "";
      const node = findNodeInTraces(traces, spanId);
      const currentlyExpanded = prev[spanId]
        ?? (node == null ? false : (isSearching ? node.children.length > 0 : node.depth < DEFAULT_EXPANDED_DEPTH));
      return { ...prev, [spanId]: !currentlyExpanded };
    });
  };

  return (
    <div>
      {traces.map((trace) => (
        <TreeNode
          key={trace.root.span.id}
          node={trace.root}
          trace={trace}
          nowMs={nowMs}
          needle={needle}
          activeSpanId={activeSpanId}
          expandedOverrides={expandedOverrides}
          onToggle={handleToggle}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </div>
  );
}

function findNodeInTraces(traces: Trace[], spanId: string): TraceNode | null {
  const stack: TraceNode[] = traces.map((trace) => trace.root);
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) break;
    if (node.span.id === spanId) return node;
    stack.push(...node.children);
  }
  return null;
}
