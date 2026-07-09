"use client";

import { cn } from "@/components/ui";
import { useState } from "react";
import type { DemoTimelineEntry } from "../fixtures";

const TONE_DOT: Record<DemoTimelineEntry["tone"], string> = {
  ok: "bg-green-500/70",
  warn: "bg-amber-500/70",
  error: "bg-red-500/70",
  neutral: "bg-foreground/25",
};

/**
 * Fused activity timeline: the customer's events and spans interleaved with
 * their support messages, so the thread and the telemetry read as one story.
 * Dot/line pattern borrowed from the email viewer's timeline.
 */
export function FusedTimeline(props: { entries: DemoTimelineEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? props.entries : props.entries.slice(0, 4);

  return (
    <div className="animate-in fade-in duration-500">
      <div className="text-[10px] text-muted-foreground/50">Timeline — events, spans, and messages</div>
      <div className="mt-1.5">
        {entries.map((entry, index) => (
          <div key={entry.id} className="flex gap-2.5">
            <div className="flex w-2 flex-col items-center">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[entry.tone])} />
              {index < entries.length - 1 && <span className="w-px flex-1 bg-foreground/[0.08]" />}
            </div>
            <div className="min-w-0 flex-1 pb-2.5">
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "min-w-0 truncate text-[11px]",
                  entry.kind === "span" ? "font-mono text-foreground/75" : "text-foreground/85",
                )}>
                  {entry.label}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/50">{entry.at}</span>
              </div>
              {entry.detail && (
                <div className={cn(
                  "text-[10px]",
                  entry.tone === "error" ? "text-red-400/80" : "text-muted-foreground/60",
                )}>
                  {entry.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {props.entries.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground/80"
        >
          {expanded ? "Show less" : `Show ${props.entries.length - 4} more`}
        </button>
      )}
    </div>
  );
}
