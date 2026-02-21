"use client";

import { cn } from "@stackframe/stack-ui";
import React from "react";

type DesignChartCardGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

const hoverTintClasses = new Map<DesignChartCardGradient, string>([
  ["blue", "group-hover:bg-blue-500/[0.03]"],
  ["cyan", "group-hover:bg-cyan-500/[0.03]"],
  ["purple", "group-hover:bg-purple-500/[0.03]"],
  ["green", "group-hover:bg-emerald-500/[0.03]"],
  ["orange", "group-hover:bg-orange-500/[0.03]"],
  ["default", "group-hover:bg-slate-500/[0.02]"],
]);

export type DesignChartCardProps = {
  gradient?: DesignChartCardGradient,
} & React.ComponentProps<"div">;

export function DesignChartCard({
  gradient = "default",
  className,
  children,
  ...props
}: DesignChartCardProps) {
  const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper {
          z-index: 9999 !important;
          overflow: visible !important;
        }
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper > * {
          overflow: visible !important;
        }
      ` }} />
      <div
        className={cn(
          "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none design-chart-card-tooltip-escape",
          "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          "shadow-sm hover:shadow-md hover:z-10",
          className
        )}
        {...props}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
        <div
          className={cn(
            "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
            hoverTintClass
          )}
        />
        <div className="relative h-full flex flex-col">
          {children}
        </div>
      </div>
    </>
  );
}
