// Visual configuration for the Deployments board.
//
// The board's look (canvas grid, node surface, how connection lines are drawn)
// is captured in a single config object, kept separate from the data / drag /
// right-pane logic. Today there is one look — "Blueprint" — but keeping it as a
// config object means the styling knobs stay in one place.

import type { ConnectorStyle } from "./connections";

export type GridStyle = "dots" | "blueprint" | "none";

export type VariantConfig = {
  gridStyle: GridStyle,
  connectorStyle: ConnectorStyle,
  connectorDashed: boolean,
  // Extra classes for the scrollable board surface (background wash, etc.).
  boardClassName: string,
  // Node surface. `selected` toggles the active ring/elevation.
  nodeClassName: string,
  nodeSelectedClassName: string,
  nodeRadiusClassName: string,
  // Whether the node shows a colored accent strip down its left edge.
  showAccentBar: boolean,
  // Use a monospaced treatment for node names / metadata (blueprint feel).
  mono: boolean,
};

export const BLUEPRINT_VARIANT: VariantConfig = {
  gridStyle: "blueprint",
  connectorStyle: "orthogonal",
  connectorDashed: true,
  boardClassName: "bg-[#f7f8fa] dark:bg-[#0b1220]",
  nodeClassName:
    "bg-white/95 dark:bg-[#0f1830]/80 backdrop-blur-md ring-1 ring-blue-500/20 dark:ring-cyan-300/20 shadow-sm hover:ring-blue-500/40 dark:hover:ring-cyan-300/35",
  nodeSelectedClassName:
    "ring-2 ring-blue-500/70 dark:ring-cyan-300/60 shadow-md",
  nodeRadiusClassName: "rounded-lg",
  showAccentBar: false,
  mono: true,
};

export type Accent = "purple" | "cyan" | "green";

export type AccentClasses = {
  // Icon chip inside the node header.
  chip: string,
  // Left accent bar.
  bar: string,
  // Connection line stroke (uses text color + currentColor on the SVG path).
  stroke: string,
};

export const ACCENT_CLASSES = new Map<Accent, AccentClasses>([
  ["purple", {
    chip: "bg-purple-500/12 text-purple-600 dark:bg-purple-400/15 dark:text-purple-300",
    bar: "bg-purple-500/70 dark:bg-purple-400/70",
    stroke: "text-purple-500/70 dark:text-purple-400/70",
  }],
  ["cyan", {
    chip: "bg-cyan-500/12 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300",
    bar: "bg-cyan-500/70 dark:bg-cyan-400/70",
    stroke: "text-cyan-500/70 dark:text-cyan-400/70",
  }],
  ["green", {
    chip: "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
    bar: "bg-emerald-500/70 dark:bg-emerald-400/70",
    stroke: "text-emerald-500/70 dark:text-emerald-400/70",
  }],
]);

export function getAccentClasses(accent: Accent): AccentClasses {
  const classes = ACCENT_CLASSES.get(accent);
  if (!classes) throw new Error(`Unknown accent: ${accent}`);
  return classes;
}

export const STATUS_META = new Map<string, { label: string, color: "green" | "cyan" | "orange" | "red" }>([
  ["deployed", { label: "Deployed", color: "green" }],
  ["building", { label: "Building", color: "cyan" }],
  ["not_deployed", { label: "Not deployed", color: "orange" }],
  ["canceled", { label: "Cancelled", color: "orange" }],
  ["crashed", { label: "Failed", color: "red" }],
]);
