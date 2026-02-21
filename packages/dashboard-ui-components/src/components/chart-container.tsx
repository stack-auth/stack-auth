"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@stackframe/stack-ui";

const THEMES = { light: "", dark: ".dark" } as const;

export type DesignChartConfig = {
  [k in string]: {
    label?: React.ReactNode,
    icon?: React.ComponentType,
  } & (
    | { color?: string, theme?: never }
    | { color?: never, theme: Record<keyof typeof THEMES, string> }
  )
};

type ChartContextProps = {
  config: DesignChartConfig,
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useDesignChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useDesignChart must be used within a <DesignChartContainer />");
  }
  return context;
}

export function DesignChartStyle({ id, config }: { id: string, config: DesignChartConfig }) {
  const colorConfig = Object.entries(config).filter(
    ([_, cfg]) => cfg.theme || cfg.color
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
              .map(([key, itemConfig]) => {
                const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color;
                return color ? `  --color-${key}: ${color};` : null;
              })
              .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
}

export const DesignChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    maxHeight?: number,
    config: DesignChartConfig,
    children: React.ComponentProps<
      typeof RechartsPrimitive.ResponsiveContainer
    >["children"],
  }
>(({ id, className, children, config, maxHeight, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-black/[0.12] dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/[0.12]",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-none",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-radial-bar-background-sector]:fill-black/[0.04] dark:[&_.recharts-radial-bar-background-sector]:fill-white/[0.04]",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-black/[0.04] dark:[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-white/[0.04]",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-reference-line_[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-sector]:outline-none",
          "[&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
        style={{
          ...props.style,
          maxHeight,
        }}
      >
        <DesignChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer maxHeight={maxHeight}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
DesignChartContainer.displayName = "DesignChartContainer";

/**
 * Helper to extract item config from a Recharts payload object.
 */
export function getPayloadConfigFromPayload(
  config: DesignChartConfig,
  payload: unknown,
  key: string,
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string;
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config];
}
