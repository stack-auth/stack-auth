"use client";

import {
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignButton,
} from "@/components/design-components";
import { XIcon } from "@phosphor-icons/react";

export type AnalyticsChartLabEvent = {
  id: number,
  ts: number,
  name: string,
  payload: string,
};

export function AnalyticsChartEventsPanel({
  events,
  onClear,
}: {
  events: AnalyticsChartLabEvent[],
  onClear: () => void,
}) {
  return (
    <DesignAnalyticsCard
      gradient="orange"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Callback events"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={onClear}
            disabled={events.length === 0}
          >
            <XIcon weight="bold" className="size-3" aria-hidden="true" />
            Clear
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        {events.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Interact with the preview — change a control, brush a range,
            create an annotation, pin a point — and the corresponding
            <span className="text-foreground"> on*Change </span>
            callback fires here.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-foreground/[0.05] rounded-lg bg-foreground/[0.02] ring-1 ring-foreground/[0.05]">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-3 px-3 py-1.5 first:rounded-t-lg last:rounded-b-lg"
              >
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 shrink-0 w-[68px]">
                  {new Date(e.ts).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="font-mono text-[11px] font-semibold text-foreground shrink-0">
                  {e.name}
                </span>
                <span className="ml-auto truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {e.payload}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}
