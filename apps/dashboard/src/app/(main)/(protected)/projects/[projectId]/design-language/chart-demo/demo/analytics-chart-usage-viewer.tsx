"use client";

import {
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignButton,
} from "@/components/design-components";
import { CursorClickIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";
import type {
  AnalyticsChartLayer,
  AnalyticsChartState,
  Annotation,
  FormatKind,
  Point,
} from "@stackframe/dashboard-ui-components";

function formatFormatKindLiteral(kind: FormatKind): string {
  const fields: string[] = [`type: "${kind.type}"`];
  for (const [key, value] of Object.entries(kind)) {
    if (key === "type" || value === undefined) continue;
    if (typeof value === "string") fields.push(`${key}: "${value}"`);
    else fields.push(`${key}: ${value}`);
  }
  return `{ ${fields.join(", ")} }`;
}

function formatLayerLiteral(l: AnalyticsChartLayer): string {
  const fields: string[] = [
    `id: "${l.id}"`,
    `kind: "${l.kind}"`,
    `label: "${l.label}"`,
    `visible: ${l.visible}`,
  ];
  if (l.kind === "primary" || l.kind === "compare") {
    fields.push(
      `color: "${l.color}"`,
      `segmented: ${l.segmented}`,
      `type: "${l.type}"`,
    );
    if (l.type === "line" || l.type === "area") {
      fields.push(`strokeStyle: "${l.strokeStyle}"`);
    }
    if (l.type === "area" || l.type === "bar") {
      fields.push(`fillOpacity: ${l.fillOpacity}`);
    }
    if (l.segments && l.segments.length > 0) {
      const rows = l.segments.length;
      const cols = l.segments[0]?.length ?? 0;
      fields.push(`segments: /* ${rows}×${cols} */`);
    }
    if (l.segmentSeries && l.segmentSeries.length > 0) {
      const keys = l.segmentSeries.map((s) => `"${s.key}"`).join(", ");
      fields.push(`segmentSeries: [${keys}]`);
    }
    if (l.inProgressFromIndex != null) {
      fields.push(`inProgressFromIndex: ${l.inProgressFromIndex}`);
    }
  } else {
    fields.push(`color: "${l.color}"`);
  }
  return `{ ${fields.join(", ")} }`;
}

function formatStateLiteral(state: AnalyticsChartState, indent: string): string {
  const inner = `${indent}  `;
  const layersBlock = state.layers
    .map((l) => `${inner}  ${formatLayerLiteral(l)},`)
    .join("\n");
  const lines = [
    `${indent}{`,
    `${inner}view: "${state.view}",`,
    `${inner}layers: [`,
    layersBlock,
    `${inner}],`,
    `${inner}xFormatKind: ${formatFormatKindLiteral(state.xFormatKind)},`,
    `${inner}yFormatKind: ${formatFormatKindLiteral(state.yFormatKind)},`,
  ];
  if (state.view === "timeseries") {
    lines.push(
      `${inner}showGrid: ${state.showGrid},`,
      `${inner}showXAxis: ${state.showXAxis},`,
      `${inner}showYAxis: ${state.showYAxis},`,
      `${inner}zoomRange: ${state.zoomRange ? `[${state.zoomRange[0]}, ${state.zoomRange[1]}]` : "null"},`,
      `${inner}pinnedIndex: ${state.pinnedIndex ?? "null"},`,
    );
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function formatLiteralValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(formatLiteralValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatLiteralValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return String(value);
}

function formatDataProp(propName: string, items: unknown[], showCount = 2): string {
  if (items.length === 0) return `  ${propName}={[]}`;
  const previewItems = items.slice(0, showCount);
  const remaining = items.length - previewItems.length;
  const lines = [`  ${propName}={[`];
  for (const item of previewItems) {
    lines.push(`    ${formatLiteralValue(item)},`);
  }
  if (remaining > 0) {
    lines.push(`    // …${remaining} more`);
  }
  lines.push("  ]}");
  return lines.join("\n");
}

export type AnalyticsChartUsageData = {
  data: Point[],
  annotations: Annotation[],
};

export function generateAnalyticsChartUsage(
  state: AnalyticsChartState,
  exampleData: AnalyticsChartUsageData,
): string {
  const lines: string[] = [
    "<AnalyticsChart",
    formatDataProp("data", exampleData.data, 2),
    formatDataProp("annotations", exampleData.annotations, 2),
  ];
  lines.push(`  state={${formatStateLiteral(state, "  ").trimStart()}}`);
  lines.push(`  onChange={setState}`);
  lines.push(`  onAnnotationCreate={(annotation) =>`);
  lines.push(`    setAnnotations((prev) => [...prev, annotation])`);
  lines.push(`  }`);
  lines.push("/>");
  return lines.join("\n");
}

export function AnalyticsChartUsageViewer({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    runAsynchronouslyWithAlert(async () => {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <DesignAnalyticsCard
      gradient="cyan"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Usage"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={handleCopy}
          >
            <CursorClickIcon weight="bold" className="size-3" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        <pre className="overflow-x-auto rounded-lg bg-foreground/[0.04] p-4 font-mono text-[11px] leading-[1.55] text-foreground ring-1 ring-foreground/[0.06]">
          <code>{code}</code>
        </pre>
      </div>
    </DesignAnalyticsCard>
  );
}
