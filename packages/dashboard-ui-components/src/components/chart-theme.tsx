"use client";

export type DesignChartColorEntry = {
  light: string,
  dark: string,
};

/**
 * Design-system-consistent chart colors that work in light and dark mode.
 * Maps to the gradient system used across the dashboard design components.
 */
export const DESIGN_CHART_COLORS: readonly DesignChartColorEntry[] = [
  { light: "hsl(221, 83%, 53%)", dark: "hsl(217, 91%, 60%)" },   // blue
  { light: "hsl(192, 91%, 36%)", dark: "hsl(188, 94%, 43%)" },   // cyan
  { light: "hsl(271, 91%, 65%)", dark: "hsl(270, 95%, 75%)" },   // purple
  { light: "hsl(160, 84%, 39%)", dark: "hsl(160, 84%, 45%)" },   // emerald/green
  { light: "hsl(38, 92%, 50%)",  dark: "hsl(38, 92%, 50%)" },    // amber/orange
  { light: "hsl(0, 84%, 60%)",   dark: "hsl(0, 84%, 65%)" },     // red
] as const;

export type DesignChartColorName = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

const colorNameIndexMap = new Map<DesignChartColorName, number>([
  ["blue", 0],
  ["cyan", 1],
  ["purple", 2],
  ["green", 3],
  ["orange", 4],
  ["red", 5],
]);

/**
 * Get a chart color by index (wraps around) or by name.
 */
export function getDesignChartColor(
  indexOrName: number | DesignChartColorName,
  mode: "light" | "dark" = "dark",
): string {
  const index = typeof indexOrName === "string"
    ? colorNameIndexMap.get(indexOrName) ?? 0
    : indexOrName % DESIGN_CHART_COLORS.length;
  return DESIGN_CHART_COLORS[index][mode];
}

/**
 * Recharts-compatible grid/axis styling constants that match the design system.
 */
export const DESIGN_CHART_GRID_COLOR = "hsl(0 0% 50% / 0.12)";
export const DESIGN_CHART_AXIS_TICK_STYLE = {
  fill: "hsl(0 0% 50% / 0.5)",
  fontSize: 11,
} as const;
