"use client";

import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { cn } from "./cn";

/**
 * Flat tinted tags in the observability dashboard's manner: a low-alpha wash of the tag's hue with
 * no ring, so a dense table of them reads as text rather than as a row of buttons. Hues come from
 * the chart tokens so tags and charts stay in the same family across light and dark.
 */
export type BadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red" | "neutral";

const badgeColorClasses = new Map<BadgeColor, string>([
  ["blue", "text-chart-1 bg-chart-1/12"],
  ["cyan", "text-chart-2 bg-chart-2/12"],
  ["purple", "text-chart-2 bg-chart-2/12"],
  ["green", "text-success bg-success/12"],
  ["orange", "text-warning bg-warning/12"],
  ["red", "text-destructive bg-destructive/12"],
  ["neutral", "text-muted-foreground bg-panel-raised"],
]);

export function Badge({
  children,
  color = "neutral",
  size = "sm",
  mono = false,
  className,
  title,
}: {
  children: React.ReactNode,
  color?: BadgeColor,
  size?: "xs" | "sm",
  mono?: boolean,
  className?: string,
  title?: string,
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-[3px] text-[10px]",
        mono && "font-mono",
        badgeColorClasses.get(color) ?? throwErr(`No badge classes for color ${color}; badgeColorClasses must cover every BadgeColor`),
        className,
      )}
    >
      {children}
    </span>
  );
}
