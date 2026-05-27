"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DesignAnalyticsCard, type AnalyticsCardGradient } from "@/components/design-components";
import { SimpleTooltip } from "@/components/ui";

type UserPageMetricCardDelta = {
  current: number,
  previous: number,
  comparisonLabel: string,
};

type UserPageMetricCardSpark = {
  values: number[],
};

type UserPageMetricCardProps = {
  label: string,
  tooltip?: string,
  value: string | number,
  description: string,
  gradient: AnalyticsCardGradient,
  delta?: UserPageMetricCardDelta,
  spark?: UserPageMetricCardSpark,
};

function formatDelta({ current, previous }: UserPageMetricCardDelta): { text: string, tone: "up" | "down" | "flat" } {
  if (previous === 0) {
    if (current === 0) return { text: "0%", tone: "flat" };
    // No comparable baseline — a percentage would be misleading (0→1 and 0→1M
    // would render identically as +100%).
    return { text: "New", tone: "up" };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: "0%", tone: "flat" };
  const sign = rounded > 0 ? "+" : "";
  return { text: `${sign}${rounded}%`, tone: rounded > 0 ? "up" : "down" };
}

// Solid stroke color per gradient family. The DesignAnalyticsCard background
// already carries the soft gradient, so the sparkline only needs an opaque
// line + a matching translucent fill.
const GRADIENT_STROKE: Record<AnalyticsCardGradient, string> = {
  blue: "rgb(59 130 246)",
  cyan: "rgb(6 182 212)",
  green: "rgb(16 185 129)",
  purple: "rgb(168 85 247)",
  orange: "rgb(249 115 22)",
  slate: "rgb(100 116 139)",
};

const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 32;
const SPARKLINE_PLOT_HEIGHT = SPARKLINE_HEIGHT - 2;
const SPARKLINE_BASELINE = SPARKLINE_HEIGHT - 1;
const SPARKLINE_ANIMATION_MS = 520;
const sparklineRestState = {
  transform: "translate(0px, 0px) scale(1, 1)",
  opacity: 1,
  transitionEnabled: true,
};

type SparklineGeometry = {
  valuesKey: string,
  linePath: string,
  areaPath: string,
  min: number,
  range: number,
  pointCount: number,
};

type SparklineMotionState = {
  transform: string,
  opacity: number,
  transitionEnabled: boolean,
};

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePrefersReducedMotion = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePrefersReducedMotion();
    mediaQuery.addEventListener("change", updatePrefersReducedMotion);
    return () => mediaQuery.removeEventListener("change", updatePrefersReducedMotion);
  }, []);

  return prefersReducedMotion;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseSparklineValues(valuesKey: string): number[] {
  if (valuesKey.length === 0) {
    return [];
  }
  return valuesKey.split(",").map((value) => Number(value));
}

function getSparklineGeometry(valuesKey: string): SparklineGeometry | null {
  const values = parseSparklineValues(valuesKey);
  if (values.length < 2) {
    return null;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const flat = max === min;
  const range = flat ? 1 : max - min;
  const step = SPARKLINE_WIDTH / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = i * step;
    // Reserve 1px top/bottom so the stroke isn't clipped.
    const y = flat ? SPARKLINE_HEIGHT / 2 : SPARKLINE_BASELINE - ((v - min) / range) * SPARKLINE_PLOT_HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M${coords.join(" L")}`;
  const areaPath = `${linePath} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT} L0,${SPARKLINE_HEIGHT} Z`;

  return {
    valuesKey,
    linePath,
    areaPath,
    min,
    range,
    pointCount: values.length,
  };
}

function getInitialSparklineMotion(previous: SparklineGeometry, current: SparklineGeometry): SparklineMotionState {
  if (previous.pointCount !== current.pointCount) {
    return {
      transform: "translate(0px, 3px) scale(0.98, 0.94)",
      opacity: 0.72,
      transitionEnabled: false,
    };
  }

  const scaleY = clampNumber(current.range / previous.range, 0.35, 2.4);
  const rawTranslateY = SPARKLINE_BASELINE
    - scaleY * SPARKLINE_BASELINE
    - ((current.min - previous.min) / previous.range) * SPARKLINE_PLOT_HEIGHT;
  const translateY = clampNumber(rawTranslateY, -SPARKLINE_HEIGHT, SPARKLINE_HEIGHT);

  return {
    transform: `translate(0px, ${translateY.toFixed(2)}px) scale(1, ${scaleY.toFixed(4)})`,
    opacity: 0.88,
    transitionEnabled: false,
  };
}

function useSparklineMotion(geometry: SparklineGeometry | null): SparklineMotionState {
  const prefersReducedMotion = usePrefersReducedMotion();
  const previousGeometryRef = useRef<SparklineGeometry | null>(null);
  const [motionState, setMotionState] = useState<SparklineMotionState>(sparklineRestState);

  useLayoutEffect(() => {
    if (geometry == null) {
      previousGeometryRef.current = null;
      setMotionState(sparklineRestState);
      return;
    }

    const previousGeometry = previousGeometryRef.current;
    previousGeometryRef.current = geometry;

    if (previousGeometry == null || previousGeometry.valuesKey === geometry.valuesKey || prefersReducedMotion) {
      setMotionState(sparklineRestState);
      return;
    }

    setMotionState(getInitialSparklineMotion(previousGeometry, geometry));
    const frameId = requestAnimationFrame(() => setMotionState(sparklineRestState));
    return () => cancelAnimationFrame(frameId);
  }, [geometry, prefersReducedMotion]);

  return motionState;
}

function Sparkline({ values, color }: { values: number[], color: string }) {
  const gradId = `metric-spark-${useId()}`;
  const valuesKey = values.join(",");
  const geometry = useMemo(() => getSparklineGeometry(valuesKey), [valuesKey]);
  const motionState = useSparklineMotion(geometry);
  const motionStyle: CSSProperties = {
    transform: motionState.transform,
    transformBox: "view-box",
    transformOrigin: "left top",
    transition: motionState.transitionEnabled
      ? `transform ${SPARKLINE_ANIMATION_MS}ms ease-out, opacity 180ms ease-out`
      : "none",
    opacity: motionState.opacity,
  };

  if (geometry == null) return null;

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g style={motionStyle}>
        <path d={geometry.areaPath} fill={`url(#${gradId})`} />
        <path
          d={geometry.linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

export function UserPageMetricCard({
  label,
  tooltip,
  value,
  description,
  gradient,
  delta,
  spark,
}: UserPageMetricCardProps) {
  const deltaInfo = delta ? formatDelta(delta) : null;
  const strokeColor = GRADIENT_STROKE[gradient];
  const showSpark = spark != null && spark.values.length >= 2;
  const labelNode = (
    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
      {label}
    </span>
  );

  return (
    <DesignAnalyticsCard
      gradient={gradient}
      chart={{ type: showSpark ? "line" : "none", tooltipType: "none", highlightMode: "none" }}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-col gap-1">
          {tooltip == null ? labelNode : (
            <SimpleTooltip tooltip={tooltip} inline className="w-fit">
              {labelNode}
            </SimpleTooltip>
          )}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold tabular-nums text-foreground leading-none">
              {value}
            </span>
            {deltaInfo && (
              <span
                className={
                  "text-[10px] font-semibold tabular-nums leading-none " +
                  (deltaInfo.tone === "up"
                    ? "text-emerald-500"
                    : deltaInfo.tone === "down"
                      ? "text-red-500"
                      : "text-muted-foreground")
                }
                title={delta ? `${delta.current} ${delta.comparisonLabel} (was ${delta.previous})` : undefined}
              >
                {deltaInfo.text}
              </span>
            )}
            <span className="truncate text-[10px] font-medium text-muted-foreground leading-none">
              {description}
            </span>
          </div>
        </div>
        {showSpark && <Sparkline values={spark.values} color={strokeColor} />}
      </div>
    </DesignAnalyticsCard>
  );
}
