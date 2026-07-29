"use client";

import { SimpleTooltip } from "@/components/ui";
import { ClockIcon, CursorClickIcon, ListBulletsIcon } from "@phosphor-icons/react";
import { formatReplayDuration } from "./replay-list-formatting";

export function ReplayActivityMetrics({
  durationMs,
  eventCount,
  clickCount,
  onActivate,
}: {
  durationMs: number,
  eventCount: number,
  clickCount: number,
  onActivate?: () => void,
}) {
  const metrics = [
    {
      label: "Replay duration",
      value: formatReplayDuration(durationMs),
      icon: ClockIcon,
    },
    {
      label: "Recorded events",
      value: eventCount.toLocaleString(),
      icon: ListBulletsIcon,
    },
    {
      label: "Recorded clicks",
      value: clickCount.toLocaleString(),
      icon: CursorClickIcon,
    },
  ];

  return (
    <div
      className="flex min-w-0 items-center gap-2.5 text-xs tabular-nums text-muted-foreground"
      aria-label="Replay activity"
      onClick={onActivate}
    >
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <SimpleTooltip
            key={metric.label}
            tooltip={`${metric.label}: ${metric.value}`}
            inline
            className="inline-flex shrink-0 items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{metric.value}</span>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}
