"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { formatDuration, traceErrorCount, type Trace, type TraceNode } from "./trace-utils";

const ESTIMATED_TRACE_ROW_HEIGHT = 61;

function DurationLabel({ startMs, endMs, nowMs }: { startMs: number, endMs: number | null, nowMs: number }) {
  if (endMs == null) {
    return <DesignBadge label="Open" color="green" size="sm" />;
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

function TraceRow({
  trace,
  nowMs,
  active,
  onSelectSpan,
}: {
  trace: Trace,
  nowMs: number,
  active: boolean,
  onSelectSpan: (rootId: string) => void,
}) {
  const root = trace.root;
  const userProfileImageUrl = stringValue(root.span.raw.user_profile_image_url);
  const userProfile = userProfileLabel(root);
  const errorCount = traceErrorCount(trace);

  return (
    <button
      type="button"
      className={cn(
        "grid h-full w-full grid-cols-[24px_minmax(0,1fr)] gap-2 border-b border-border/30 px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/20",
        active && "bg-foreground/[0.06] hover:bg-foreground/[0.06]",
      )}
      onClick={() => onSelectSpan(root.span.id)}
    >
      <TraceAvatar imageUrl={userProfileImageUrl} label={userProfile} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-foreground">
            {root.span.spanType}
          </span>
          <DurationLabel startMs={trace.startMs} endMs={trace.endMs} nowMs={nowMs} />
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{new Date(trace.startMs).toLocaleString()}</span>
          {errorCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-red-600 dark:text-red-400">
              <WarningCircleIcon className="h-3 w-3" />
              {errorCount}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * A parent-trace list, not a second waterfall. Span-level navigation belongs in the
 * selected trace pane; keeping this list flat prevents automatic
 * instrumentation from multiplying every trace into hundreds of controls.
 */
export function SpanTreeList({
  traces,
  nowMs,
  activeSpanId,
  onSelectSpan,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: {
  traces: Trace[],
  nowMs: number,
  /** The parent trace currently shown in the waterfall. */
  activeSpanId: string | null,
  onSelectSpan: (rootId: string) => void,
  hasMore: boolean,
  loadingMore: boolean,
  loadMoreError: string | null,
  onLoadMore: () => void,
}) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const loaderRowVisible = hasMore || loadingMore || loadMoreError != null;
  const virtualizer = useVirtualizer({
    count: traces.length + (loaderRowVisible ? 1 : 0),
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ESTIMATED_TRACE_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => traces[index]?.root.span.id ?? "trace-list-loader",
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (lastVirtualRowIndex >= traces.length - 8 && hasMore && !loadingMore && loadMoreError == null) {
      onLoadMore();
    }
  }, [hasMore, lastVirtualRowIndex, loadMoreError, loadingMore, onLoadMore, traces.length]);

  return (
    <div ref={scrollElementRef} className="h-full overflow-y-auto overscroll-contain">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualRows.map((virtualRow) => {
          if (virtualRow.index === traces.length) {
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 flex w-full items-center justify-center border-t border-border/30 px-3 text-xs text-muted-foreground"
                style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
              >
                {loadMoreError != null ? (
                  <DesignButton variant="plain" size="sm" onClick={onLoadMore}>
                    Retry loading older traces
                  </DesignButton>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" />
                    Loading older traces…
                  </span>
                )}
              </div>
            );
          }
          const trace = traces[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 w-full"
              style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
            >
              <TraceRow
                trace={trace}
                nowMs={nowMs}
                active={trace.root.span.id === activeSpanId}
                onSelectSpan={onSelectSpan}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
