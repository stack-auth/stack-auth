"use client";

import {
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignButton,
  DesignPillToggle,
} from "@/components/design-components";
import {
  ArrowsClockwiseIcon,
  ChartBarIcon,
  ChartLineIcon,
  ChartLineUpIcon,
  ChartPieIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  DEFAULT_FORMAT_KIND,
  findLayerById,
  isAnalyticsChartDataLayer,
  patchLayerById,
  setLayerById,
  type AnalyticsChartAnnotationsLayer,
  type AnalyticsChartDataLayer,
  type AnalyticsChartLayer,
  type AnalyticsChartLayerType,
  type AnalyticsChartState,
  type AnalyticsChartStrokeStyle,
  type AnalyticsChartTimeseriesState,
  type AnalyticsChartView,
  type FormatKind,
  type FormatKindDatetime,
  type FormatKindPercent,
  type FormatKindType,
} from "@stackframe/dashboard-ui-components";

/** Shared wrapper row used throughout the state panel: rounded border,
 * subtle background, label + mono key caption, and a right-side slot. */
function FieldRow({
  label,
  keyName,
  right,
  children,
}: {
  label: string,
  keyName: string,
  right?: ReactNode,
  children?: ReactNode,
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[12px] font-medium text-foreground">{label}</span>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {keyName}
          </div>
        </div>
        {right != null && <div className="flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** Boolean on/off toggle with the shared FieldRow chrome. */
function BoolFieldRow({
  label,
  keyName,
  value,
  onChange,
}: {
  label: string,
  keyName: string,
  value: boolean,
  onChange: (next: boolean) => void,
}) {
  return (
    <FieldRow
      label={label}
      keyName={keyName}
      right={
        <DesignPillToggle
          size="sm"
          gradient="default"
          options={[
            { id: "off", label: "Off" },
            { id: "on", label: "On" },
          ]}
          selected={value ? "on" : "off"}
          onSelect={(id) => onChange(id === "on")}
        />
      }
    />
  );
}

/** Data-layer row — type picker, color, stroke, fill, segmentation, in-progress. */
function DataLayerRow({
  layer,
  dataLength,
  setLayerType,
  setLayerStrokeStyle,
  setLayerFillOpacity,
  setLayerSegmented,
  setLayerInProgress,
  setLayerVisible,
  setLayerColor,
}: {
  layer: AnalyticsChartDataLayer,
  dataLength: number,
  setLayerType: (id: string, next: AnalyticsChartLayerType) => void,
  setLayerStrokeStyle: (id: string, next: AnalyticsChartStrokeStyle) => void,
  setLayerFillOpacity: (id: string, next: number) => void,
  setLayerSegmented: (id: string, next: boolean) => void,
  setLayerInProgress: (id: string, next: number | null) => void,
  setLayerVisible: (id: string, next: boolean) => void,
  setLayerColor: (id: string, next: string) => void,
}) {
  const supportsStroke = layer.type === "line" || layer.type === "area";
  const supportsFill = layer.type === "area" || layer.type === "bar";
  const currentStroke = "strokeStyle" in layer ? layer.strokeStyle : undefined;
  const currentFill = "fillOpacity" in layer ? layer.fillOpacity : undefined;
  return (
    <FieldRow
      label={layer.label}
      keyName={`layers.${layer.id}`}
      right={
        <>
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "line", label: "Line", icon: ChartLineIcon },
              { id: "area", label: "Area", icon: ChartLineUpIcon },
              { id: "bar", label: "Bar", icon: ChartBarIcon },
            ]}
            selected={layer.type}
            onSelect={(id) => setLayerType(layer.id, id as AnalyticsChartLayerType)}
          />
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "off", label: "Hide" },
              { id: "on", label: "Show" },
            ]}
            selected={layer.visible ? "on" : "off"}
            onSelect={(id) => setLayerVisible(layer.id, id === "on")}
          />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            color
          </span>
          <input
            type="color"
            value={layer.color}
            onChange={(e) => setLayerColor(layer.id, e.target.value)}
            aria-label={`${layer.label} color`}
            className="size-6 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
          />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {layer.color}
          </span>
        </label>
        {supportsStroke && currentStroke !== undefined && (
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              stroke
            </span>
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "solid", label: "Solid" },
                { id: "dashed", label: "Dashed" },
                { id: "dotted", label: "Dotted" },
              ]}
              selected={currentStroke}
              onSelect={(id) => setLayerStrokeStyle(layer.id, id as AnalyticsChartStrokeStyle)}
            />
          </label>
        )}
        {supportsFill && currentFill !== undefined && (
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              fill
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={currentFill}
              onChange={(e) => setLayerFillOpacity(layer.id, Number(e.target.value))}
              aria-label={`${layer.label} fill opacity`}
              className="h-1 w-20 cursor-pointer accent-foreground/60"
            />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {currentFill.toFixed(2)}
            </span>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            segmented
          </span>
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "off", label: "Off" },
              { id: "on", label: "On" },
            ]}
            selected={layer.segmented ? "on" : "off"}
            onSelect={(id) => setLayerSegmented(layer.id, id === "on")}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            in&#8209;progress
          </span>
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "off", label: "Off" },
              { id: "on", label: "On" },
            ]}
            selected={layer.inProgressFromIndex != null ? "on" : "off"}
            onSelect={(id) => setLayerInProgress(layer.id, id === "on" ? dataLength - 1 : null)}
          />
        </label>
      </div>
    </FieldRow>
  );
}

/** Annotations-layer row — color + visibility only. */
function AnnotationsLayerRow({
  layer,
  setLayerColor,
  setLayerVisible,
}: {
  layer: AnalyticsChartAnnotationsLayer,
  setLayerColor: (id: string, next: string) => void,
  setLayerVisible: (id: string, next: boolean) => void,
}) {
  return (
    <FieldRow
      label={layer.label}
      keyName={`layers.${layer.id}`}
      right={
        <>
          <label className="flex items-center gap-1.5">
            <input
              type="color"
              value={layer.color}
              onChange={(e) => setLayerColor(layer.id, e.target.value)}
              aria-label={`${layer.label} color`}
              className="size-6 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
            />
          </label>
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "off", label: "Hide" },
              { id: "on", label: "Show" },
            ]}
            selected={layer.visible ? "on" : "off"}
            onSelect={(id) => setLayerVisible(layer.id, id === "on")}
          />
        </>
      }
    />
  );
}

function FormatKindOptions({
  kind,
  onChange,
}: {
  kind: FormatKind,
  onChange: (next: FormatKind) => void,
}) {
  const optionLabel = (text: string) => (
    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
      {text}
    </span>
  );
  switch (kind.type) {
    case "numeric": {
      const decimals = kind.decimals ?? 0;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("decimals")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
                { id: "3", label: "3" },
              ]}
              selected={String(decimals)}
              onSelect={(id) => onChange({ ...kind, decimals: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "short": {
      const precision = kind.precision ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("precision")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
              ]}
              selected={String(precision)}
              onSelect={(id) => onChange({ ...kind, precision: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "currency": {
      const currency = kind.currency ?? "USD";
      const divisor = kind.divisor ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("currency")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "USD", label: "USD" },
                { id: "EUR", label: "EUR" },
                { id: "GBP", label: "GBP" },
                { id: "JPY", label: "JPY" },
              ]}
              selected={currency}
              onSelect={(id) => onChange({ ...kind, currency: id })}
            />
          </label>
          <label className="flex items-center gap-1.5">
            {optionLabel("divisor")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "1", label: "1" },
                { id: "100", label: "100" },
              ]}
              selected={String(divisor)}
              onSelect={(id) => onChange({ ...kind, divisor: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "duration": {
      const unit = kind.unit ?? "s";
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("unit")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "ms", label: "ms" },
                { id: "s", label: "s" },
                { id: "m", label: "m" },
                { id: "h", label: "h" },
              ]}
              selected={unit}
              onSelect={(id) => onChange({ ...kind, unit: id as "ms" | "s" | "m" | "h" })}
            />
          </label>
        </div>
      );
    }
    case "datetime": {
      const style = kind.style ?? "short";
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("style")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "short", label: "Short" },
                { id: "long", label: "Long" },
                { id: "iso", label: "ISO" },
                { id: "relative", label: "Relative" },
              ]}
              selected={style}
              onSelect={(id) =>
                onChange({ ...kind, style: id as FormatKindDatetime["style"] })
              }
            />
          </label>
        </div>
      );
    }
    case "percent": {
      const source = kind.source ?? "fraction";
      const decimals = kind.decimals ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("source")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "fraction", label: "0..1" },
                { id: "basis", label: "0..10000" },
                { id: "whole", label: "0..100" },
              ]}
              selected={source}
              onSelect={(id) =>
                onChange({ ...kind, source: id as FormatKindPercent["source"] })
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            {optionLabel("decimals")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
              ]}
              selected={String(decimals)}
              onSelect={(id) => onChange({ ...kind, decimals: Number(id) })}
            />
          </label>
        </div>
      );
    }
  }
}

function rebuildDataLayer(
  current: AnalyticsChartDataLayer,
  nextType: AnalyticsChartLayerType,
): AnalyticsChartDataLayer {
  const prevStroke: AnalyticsChartStrokeStyle =
    "strokeStyle" in current ? current.strokeStyle : "solid";
  const prevFill: number =
    "fillOpacity" in current ? current.fillOpacity : 0.22;
  const base = {
    id: current.id,
    kind: current.kind,
    label: current.label,
    visible: current.visible,
    color: current.color,
    segmented: current.segmented,
    segments: current.segments,
    segmentSeries: current.segmentSeries,
    inProgressFromIndex: current.inProgressFromIndex,
  };
  if (nextType === "line") return { ...base, type: "line", strokeStyle: prevStroke };
  if (nextType === "bar") return { ...base, type: "bar", fillOpacity: prevFill };
  return { ...base, type: "area", strokeStyle: prevStroke, fillOpacity: prevFill };
}

export function AnalyticsChartStatePanel({
  state,
  onChange,
  onReset,
  dataLength,
}: {
  state: AnalyticsChartState,
  onChange: React.Dispatch<React.SetStateAction<AnalyticsChartState>>,
  onReset: () => void,
  dataLength: number,
}) {
  const setTimeseriesField = <K extends keyof AnalyticsChartTimeseriesState>(
    key: K,
    value: AnalyticsChartTimeseriesState[K],
  ) => {
    onChange((prev) => {
      if (prev.view !== "timeseries") return prev;
      return { ...prev, [key]: value };
    });
  };
  const setView = (next: AnalyticsChartView) => {
    onChange((prev) => {
      if (next === prev.view) return prev;
      if (next === "pie") {
        return {
          view: "pie",
          layers: prev.layers,
          xFormatKind: prev.xFormatKind,
          yFormatKind: prev.yFormatKind,
        };
      }
      return {
        view: "timeseries",
        layers: prev.layers,
        xFormatKind: prev.xFormatKind,
        yFormatKind: prev.yFormatKind,
        showGrid: true,
        showXAxis: true,
        showYAxis: true,
        zoomRange: null,
        pinnedIndex: null,
      };
    });
  };
  const setXFormatKind = (next: FormatKind) => {
    onChange((prev) => ({ ...prev, xFormatKind: next }));
  };
  const setYFormatKind = (next: FormatKind) => {
    onChange((prev) => ({ ...prev, yFormatKind: next }));
  };
  const patchLayer = (id: string, patch: Record<string, unknown>) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, patch),
    }));
  };
  const replaceLayer = (id: string, next: AnalyticsChartLayer) => {
    onChange((prev) => ({
      ...prev,
      layers: setLayerById(prev.layers, id, next),
    }));
  };

  const setLayerType = (id: string, nextType: AnalyticsChartLayerType) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    replaceLayer(id, rebuildDataLayer(current, nextType));
  };
  const setLayerStrokeStyle = (id: string, style: AnalyticsChartStrokeStyle) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    if (current.type === "bar") return;
    replaceLayer(id, { ...current, strokeStyle: style });
  };
  const setLayerFillOpacity = (id: string, fillOpacity: number) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    if (current.type === "line") return;
    replaceLayer(id, { ...current, fillOpacity });
  };
  const setLayerSegmented = (id: string, segmented: boolean) => patchLayer(id, { segmented });
  const setLayerInProgress = (id: string, inProgressFromIndex: number | null) =>
    patchLayer(id, { inProgressFromIndex });
  const setLayerVisible = (id: string, visible: boolean) => patchLayer(id, { visible });
  const setLayerColor = (id: string, color: string) => patchLayer(id, { color });

  return (
    <DesignAnalyticsCard
      gradient="green"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="State · mix and match"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={onReset}
          >
            <ArrowsClockwiseIcon weight="bold" className="size-3" aria-hidden="true" />
            Reset
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        <p className="mb-3 text-[12px] text-muted-foreground">
          The legend items are the source of truth. Each layer has its own
          visibility and (where it makes sense) its own chart type. Set
          Sign-ups to <span className="font-mono text-[11px] text-foreground">bar</span>
          {" "}while leaving Previous period as <span className="font-mono text-[11px] text-foreground">line</span>
          {" "}and you get bars with a dashed line overlay — no special &ldquo;mixed&rdquo;
          mode needed. Segmentation is per-layer too: toggle
          {" "}<span className="font-mono text-[11px] text-foreground">signups.segmented</span>
          {" "}and <span className="font-mono text-[11px] text-foreground">previous.segmented</span>
          {" "}independently. Pie is a separate
          {" "}<span className="font-mono text-[11px] text-foreground">view</span>.
        </p>
        <div className="flex flex-col gap-3">
          <FieldRow
            label="View"
            keyName="view"
            right={
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "timeseries", label: "Timeseries", icon: ChartLineUpIcon },
                  { id: "pie", label: "Pie", icon: ChartPieIcon },
                ]}
                selected={state.view}
                onSelect={(id) => setView(id as AnalyticsChartView)}
              />
            }
          />
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Layers · source of truth
            </span>
            {state.layers.map((layer) => {
              if (isAnalyticsChartDataLayer(layer)) {
                return (
                  <DataLayerRow
                    key={layer.id}
                    layer={layer}
                    dataLength={dataLength}
                    setLayerType={setLayerType}
                    setLayerStrokeStyle={setLayerStrokeStyle}
                    setLayerFillOpacity={setLayerFillOpacity}
                    setLayerSegmented={setLayerSegmented}
                    setLayerInProgress={setLayerInProgress}
                    setLayerVisible={setLayerVisible}
                    setLayerColor={setLayerColor}
                  />
                );
              }
              return (
                <AnnotationsLayerRow
                  key={layer.id}
                  layer={layer}
                  setLayerColor={setLayerColor}
                  setLayerVisible={setLayerVisible}
                />
              );
            })}
          </div>
          <FieldRow
            label="X-axis format"
            keyName="xFormatKind.type"
            right={
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "numeric", label: "Numeric" },
                  { id: "short", label: "Short" },
                  { id: "currency", label: "Currency" },
                  { id: "duration", label: "Duration" },
                  { id: "datetime", label: "Date" },
                  { id: "percent", label: "Percent" },
                ]}
                selected={state.xFormatKind.type}
                onSelect={(id) =>
                  setXFormatKind(DEFAULT_FORMAT_KIND[id as FormatKindType])
                }
              />
            }
          >
            <FormatKindOptions
              kind={state.xFormatKind}
              onChange={(next) => setXFormatKind(next)}
            />
          </FieldRow>
          <FieldRow
            label="Y-axis format"
            keyName="yFormatKind.type"
            right={
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "numeric", label: "Numeric" },
                  { id: "short", label: "Short" },
                  { id: "currency", label: "Currency" },
                  { id: "duration", label: "Duration" },
                  { id: "datetime", label: "Date" },
                  { id: "percent", label: "Percent" },
                ]}
                selected={state.yFormatKind.type}
                onSelect={(id) =>
                  setYFormatKind(DEFAULT_FORMAT_KIND[id as FormatKindType])
                }
              />
            }
          >
            <FormatKindOptions
              kind={state.yFormatKind}
              onChange={(next) => setYFormatKind(next)}
            />
          </FieldRow>
          {state.view === "timeseries" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <BoolFieldRow
                label="Grid lines"
                keyName="showGrid"
                value={state.showGrid}
                onChange={(v) => setTimeseriesField("showGrid", v)}
              />
              <BoolFieldRow
                label="X-axis labels"
                keyName="showXAxis"
                value={state.showXAxis}
                onChange={(v) => setTimeseriesField("showXAxis", v)}
              />
              <BoolFieldRow
                label="Y-axis labels"
                keyName="showYAxis"
                value={state.showYAxis}
                onChange={(v) => setTimeseriesField("showYAxis", v)}
              />
            </div>
          )}
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}
