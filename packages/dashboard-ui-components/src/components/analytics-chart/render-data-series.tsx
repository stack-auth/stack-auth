import type { ReactNode } from "react";
import { Area, Bar, Line } from "recharts";
import type {
  AnalyticsChartDataLayer,
  AnalyticsChartSeries,
} from "./types";

/** Area layers use fill-only `<Area>` plus `<Line>` for the top edge (not Recharts' closed-path stroke). */
export type RenderDataSeriesArgs = {
  layer: AnalyticsChartDataLayer,
  segmented: boolean,
  segmentSeries: readonly AnalyticsChartSeries[],
  segKey: (segKey: string) => string,
  stackId: string,
  strokeDasharray: string | undefined,
  segmentedStrokeDasharray: string | undefined,
  fillOpacity: number,
  segmentedFillOpacity: number,
  baseOpacity?: number,
  strokeWidth: number,
  segmentedStrokeWidth: number,
  inProgressKeys: { solid: string, dashed: string } | null,
};

/** Return value must be spread into `<ComposedChart>` as siblings — do not wrap in `<Fragment>`. */
export function renderDataSeries(args: RenderDataSeriesArgs): ReactNode[] {
  const {
    layer,
    segmented,
    segmentSeries,
    segKey,
    stackId,
    strokeDasharray,
    segmentedStrokeDasharray,
    fillOpacity,
    segmentedFillOpacity,
    baseOpacity = 1,
    strokeWidth,
    segmentedStrokeWidth,
    inProgressKeys,
  } = args;

  const nodes: ReactNode[] = [];

  if (segmented) {
    segmentSeries.forEach((s, sIdx) => {
      const key = segKey(s.key);
      const nodeKey = `${layer.id}_seg_${s.key}`;
      if (layer.type === "bar") {
        const isTop = sIdx === segmentSeries.length - 1;
        nodes.push(
          <Bar
            key={nodeKey}
            dataKey={key}
            stackId={stackId}
            fill={`var(--color-${key})`}
            radius={isTop ? [2, 2, 0, 0] : 0}
            isAnimationActive={false}
            opacity={baseOpacity}
          />,
        );
      } else if (layer.type === "area") {
        nodes.push(
          <Area
            key={nodeKey}
            dataKey={key}
            stackId={stackId}
            type="linear"
            fill={`var(--color-${key})`}
            fillOpacity={segmentedFillOpacity}
            stroke={`var(--color-${key})`}
            strokeWidth={segmentedStrokeWidth}
            strokeDasharray={segmentedStrokeDasharray}
            isAnimationActive={false}
            opacity={baseOpacity}
          />,
        );
      } else {
        nodes.push(
          <Line
            key={nodeKey}
            dataKey={key}
            type="linear"
            stroke={`var(--color-${key})`}
            strokeWidth={strokeWidth}
            strokeDasharray={segmentedStrokeDasharray}
            dot={false}
            isAnimationActive={false}
            opacity={baseOpacity}
          />,
        );
      }
    });
    return nodes;
  }

  if (layer.type === "bar") {
    nodes.push(
      <Bar
        key={`${layer.id}_main`}
        dataKey={layer.id}
        fill={`var(--color-${layer.id})`}
        radius={2}
        isAnimationActive={false}
      />,
    );
    return nodes;
  }

  if (layer.type === "area") {
    nodes.push(
      <Area
        key={`${layer.id}_area`}
        dataKey={layer.id}
        type="linear"
        fill={`var(--color-${layer.id})`}
        fillOpacity={fillOpacity}
        stroke="none"
        isAnimationActive={false}
      />,
    );
  }

  if (inProgressKeys) {
    nodes.push(
      <Line
        key={`${layer.id}_solid`}
        dataKey={inProgressKeys.solid}
        type="linear"
        stroke={`var(--color-${layer.id})`}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        dot={false}
        isAnimationActive={false}
        connectNulls
      />,
    );
    nodes.push(
      <Line
        key={`${layer.id}_dashed`}
        dataKey={inProgressKeys.dashed}
        type="linear"
        stroke={`var(--color-${layer.id})`}
        strokeWidth={strokeWidth}
        strokeDasharray="4 4"
        dot={false}
        isAnimationActive={false}
        connectNulls
        opacity={0.85}
      />,
    );
  } else {
    nodes.push(
      <Line
        key={`${layer.id}_line`}
        dataKey={layer.id}
        type="linear"
        stroke={`var(--color-${layer.id})`}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        dot={false}
        isAnimationActive={false}
        opacity={baseOpacity}
      />,
    );
  }

  return nodes;
}
