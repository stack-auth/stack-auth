"use client";

import { cn } from "@/components/ui";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { DEMO_INCIDENT } from "../fixtures";

export function IncidentBanner(props: { released: boolean, onRelease: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-b border-foreground/[0.06] px-5 py-2.5 animate-in fade-in slide-in-from-top-1 duration-500">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={cn("absolute inline-flex h-full w-full rounded-full bg-amber-500/50", !props.released && "animate-ping")} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500/80" />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs text-foreground/80">
          {DEMO_INCIDENT.title} — {DEMO_INCIDENT.reportCount} reports in {DEMO_INCIDENT.windowMinutes} minutes
        </p>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground/80"
        >
          Status draft
          <CaretDownIcon className={cn("h-3 w-3 transition-transform duration-200", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 rounded-lg bg-foreground/[0.02] px-3 py-2.5 animate-in fade-in duration-200">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{DEMO_INCIDENT.statusDraft}</p>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="text-[11px] font-medium text-foreground/70 transition-colors hover:text-foreground">
              Publish to status page
            </button>
            {!props.released && (
              <button
                type="button"
                onClick={props.onRelease}
                className="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground/80"
              >
                Release held replies
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
