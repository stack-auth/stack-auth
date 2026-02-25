"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@stackframe/stack-ui";
import { useDesignChart, getPayloadConfigFromPayload } from "./chart-container";

export const DesignChartTooltip = RechartsPrimitive.Tooltip;

export const DesignChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
    React.ComponentProps<"div"> & {
      hideLabel?: boolean,
      hideIndicator?: boolean,
      indicator?: "line" | "dot" | "dashed",
      nameKey?: string,
      labelKey?: string,
    }
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref
  ) => {
    const { config } = useDesignChart();

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null;
      }

      const [item] = payload;
      const key = `${labelKey || item.dataKey || item.name || "value"}`;
      const itemConfig = getPayloadConfigFromPayload(config, item, key);
      const configEntry = typeof label === "string" ? config[label as keyof typeof config] : undefined;
      const value =
        !labelKey && typeof label === "string"
          ? configEntry?.label ?? label
          : itemConfig?.label;

      if (labelFormatter) {
        return (
          <div className={cn("font-medium text-muted-foreground tracking-wide", labelClassName)}>
            {labelFormatter(value, payload)}
          </div>
        );
      }

      if (!value) {
        return null;
      }

      return <div className={cn("font-medium text-muted-foreground tracking-wide", labelClassName)}>{value}</div>;
    }, [
      label,
      labelFormatter,
      payload,
      hideLabel,
      labelClassName,
      config,
      labelKey,
    ]);

    if (!active || !payload?.length) {
      return null;
    }

    const nestLabel = payload.length === 1 && indicator !== "dot";

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-xl bg-background/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]",
          className
        )}
        style={{ zIndex: 9999 }}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color || item.payload.fill || item.color;

            return (
              <div
                key={item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-full",
                            {
                              "h-2 w-2 ring-2 ring-white/20": indicator === "dot",
                              "w-1 rounded-[2px]": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent rounded-[2px]":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            }
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                              backgroundColor: indicator === "dot" ? indicatorColor : undefined,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-[11px] text-muted-foreground">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
                          {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
DesignChartTooltipContent.displayName = "DesignChartTooltipContent";
