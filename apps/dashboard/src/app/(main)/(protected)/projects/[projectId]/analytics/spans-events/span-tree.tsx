"use client";

import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatDuration, subtreeMatches, type Trace, type TraceNode } from "./trace-utils";

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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function userProfileLabel(node: TraceNode): string | null {
  return stringValue(node.span.raw.user_display_name)
    ?? stringValue(node.span.raw.user_primary_email);
}

function userProfileInitials(label: string): string {
  return label.trim().slice(0, 2).toUpperCase();
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialsAvatarDataUrl(initials: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#e5e7eb"/><text x="20" y="24" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="700" fill="#6b7280">${escapeSvgText(initials)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function TraceAvatar({ imageUrl, label }: { imageUrl: string | null, label: string | null }) {
  const avatarSrc = imageUrl ?? (label != null ? initialsAvatarDataUrl(userProfileInitials(label)) : undefined);
  return (
    <Avatar className="h-5 w-5 border border-border/60 bg-muted text-muted-foreground">
      <AvatarImage src={avatarSrc} alt={label ?? "User profile picture"} />
      <AvatarFallback className="bg-muted" title={label ?? "User profile"} />
    </Avatar>
  );
}

function collectVisibleSubtreeIds(node: TraceNode, needle: string): string[] {
  const visibleChildren = needle === ""
    ? node.children
    : node.children.filter((child) => subtreeMatches(child, needle));
  return [
    node.span.id,
    ...visibleChildren.flatMap((child) => collectVisibleSubtreeIds(child, needle)),
  ];
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
  expandedOverrides: Map<string, boolean>,
  onToggle: (node: TraceNode, recursive: boolean) => void,
  onSelectSpan: (rootId: string, spanId: string) => void,
}) {
  const isSearching = needle !== "";
  const visibleChildren = isSearching
    ? node.children.filter((child) => subtreeMatches(child, needle))
    : node.children;
  const hasChildren = visibleChildren.length > 0;
  const expanded = expandedOverrides.get(node.span.id)
    ?? (isSearching ? hasChildren : node.depth < DEFAULT_EXPANDED_DEPTH);
  const isActive = node.span.id === activeSpanId;
  const isRoot = node.depth === 0;
  const userProfileImageUrl = stringValue(node.span.raw.user_profile_image_url);
  const userProfile = userProfileLabel(node);
  const rowGridTemplateColumns = `${8 + node.depth * 12}px 16px 20px minmax(0, 1fr)`;

  return (
    <>
      <div
        className={cn(
          "w-full grid items-center gap-x-1.5 pr-3 border-b border-border/20 hover:bg-muted/30 transition-colors hover:transition-none cursor-pointer min-w-0",
          isRoot ? "py-2" : "py-1.5",
          isActive && "bg-muted/50 hover:bg-muted/50",
        )}
        style={{ gridTemplateColumns: rowGridTemplateColumns }}
        onClick={() => onSelectSpan(trace.root.span.id, node.span.id)}
      >
        <span aria-hidden />
        {hasChildren ? (
          <button
            className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            title={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node, e.altKey);
            }}
          >
            <CaretRightIcon className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="h-4 w-4" />
        )}
        {isRoot ? (
          <TraceAvatar imageUrl={userProfileImageUrl} label={userProfile} />
        ) : (
          <span className="h-5 w-5" />
        )}
        <div className="min-w-0">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span
              className={cn(
                "font-mono text-xs truncate",
                isRoot ? "font-semibold" : "font-medium",
                isSearching && nodeMatches(node, needle) && "rounded bg-amber-500/15 px-0.5",
              )}
            >
              {node.span.spanType}
            </span>
            <span className="shrink-0">
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
            <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{new Date(trace.startMs).toLocaleString()}</span>
              <span className="shrink-0">{trace.spanCount}s · {trace.eventCount}e</span>
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
  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(() => new Map());

  const handleToggle = (node: TraceNode, recursive: boolean) => {
    setExpandedOverrides((prev) => {
      const isSearching = needle !== "";
      const currentlyExpanded = prev.get(node.span.id)
        ?? (isSearching ? node.children.length > 0 : node.depth < DEFAULT_EXPANDED_DEPTH);
      const nextExpanded = !currentlyExpanded;
      const next = new Map(prev);
      const spanIds = recursive ? collectVisibleSubtreeIds(node, needle) : [node.span.id];
      for (const spanId of spanIds) {
        next.set(spanId, nextExpanded);
      }
      return next;
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
