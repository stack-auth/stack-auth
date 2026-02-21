"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@stackframe/stack-ui";
import { useDesignChart, getPayloadConfigFromPayload } from "./chart-container";

export const DesignChartLegend = RechartsPrimitive.Legend;

export const DesignChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
      hideIcon?: boolean,
      nameKey?: string,
    }
>(
  (
    { className, hideIcon = false, payload, verticalAlign = "bottom", nameKey },
    ref
  ) => {
    const { config } = useDesignChart();

    if (!payload?.length) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center justify-center gap-2",
          verticalAlign === "top" ? "pb-3" : "pt-3",
          className
        )}
      >
        {payload.map((item) => {
          const key = `${nameKey || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={item.value}
              className={cn(
                "flex items-center gap-1.5 rounded-full bg-foreground/[0.03] ring-1 ring-foreground/[0.06] px-3 py-1.5 text-xs",
                "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.05]"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span className="font-medium text-foreground">
                {itemConfig?.label || item.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
);
DesignChartLegendContent.displayName = "DesignChartLegendContent";
