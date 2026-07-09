"use client";

import { cn } from "@/components/ui";

/**
 * Quiet confidence readout: thin bar with a tick at the 90% auto-reply
 * threshold. Stays monochrome below the threshold, tints green above it.
 */
export function ConfidenceMeter(props: { value: number, className?: string }) {
  const clamped = Math.max(0, Math.min(100, props.value));
  const aboveThreshold = clamped >= 90;
  return (
    <div className={cn("flex items-center gap-2", props.className)} title={`AI confidence ${clamped}% — auto-replies at 90%`}>
      <span className="text-[11px] tabular-nums text-muted-foreground/70">{clamped}%</span>
      <div className="relative h-[3px] w-16 overflow-hidden rounded-full bg-foreground/[0.08]">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out",
            aboveThreshold ? "bg-green-500/70" : "bg-foreground/30",
          )}
          style={{ width: `${clamped}%` }}
        />
        <div className="absolute inset-y-0 left-[90%] w-px bg-foreground/25" />
      </div>
    </div>
  );
}
