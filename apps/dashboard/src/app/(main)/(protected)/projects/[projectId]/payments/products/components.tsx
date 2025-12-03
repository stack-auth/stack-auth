import { cn } from "@/lib/utils";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import {
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@stackframe/stack-ui";
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { DEFAULT_INTERVAL_UNITS } from "./utils";

// ============================================================================
// Small UI Components
// ============================================================================

/**
 * OR separator with lines on both sides
 */
export function OrSeparator() {
  return (
    <div className="flex items-center justify-center my-1">
      <div className="flex-1 h-px bg-foreground/[0.06]" />
      <span className="mx-3 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">or</span>
      <div className="flex-1 h-px bg-foreground/[0.06]" />
    </div>
  );
}

/**
 * Section heading with horizontal lines
 */
export function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ============================================================================
// Interval Popover Component
// ============================================================================

type IntervalPopoverProps = {
  readOnly?: boolean,
  intervalText: string | null,
  intervalSelection: 'one-time' | 'custom' | DayInterval[1],
  unit: DayInterval[1] | undefined,
  count: number,
  setIntervalSelection: (s: 'one-time' | 'custom' | DayInterval[1]) => void,
  setUnit: (u: DayInterval[1] | undefined) => void,
  setCount: (n: number) => void,
  onChange: (interval: DayInterval | null) => void,
  noneLabel?: string,
  allowedUnits?: DayInterval[1][],
  triggerClassName?: string,
  useDurationLabels?: boolean,
};

/**
 * Reusable interval selector with preset options and custom input
 */
export function IntervalPopover({
  readOnly,
  intervalText,
  intervalSelection,
  unit,
  count,
  setIntervalSelection,
  setUnit,
  setCount,
  onChange,
  noneLabel = 'one time',
  allowedUnits,
  triggerClassName,
  useDurationLabels = false,
}: IntervalPopoverProps) {
  const [open, setOpen] = useState(false);

  const buttonLabels: Record<DayInterval[1], string> = useDurationLabels ? {
    day: '1 day',
    week: '1 week',
    month: '1 month',
    year: '1 year',
  } : {
    day: 'daily',
    week: 'weekly',
    month: 'monthly',
    year: 'yearly',
  };

  const units = allowedUnits ?? DEFAULT_INTERVAL_UNITS;
  const normalizedUnits = units.length > 0 ? units : DEFAULT_INTERVAL_UNITS;
  const defaultUnit = (normalizedUnits[0] ?? 'month') as DayInterval[1];
  const effectiveUnit = unit && normalizedUnits.includes(unit) ? unit : defaultUnit;
  const isIntervalUnit = intervalSelection !== 'custom' && intervalSelection !== 'one-time';
  const effectiveSelection: 'one-time' | 'custom' | DayInterval[1] =
    isIntervalUnit && !normalizedUnits.includes(intervalSelection)
      ? 'custom'
      : intervalSelection;

  const selectOneTime = () => {
    setIntervalSelection('one-time');
    setUnit(undefined);
    setCount(1);
    if (!readOnly) onChange(null);
    setOpen(false);
  };

  const selectFixed = (unitOption: DayInterval[1]) => {
    if (!normalizedUnits.includes(unitOption)) return;
    setIntervalSelection(unitOption);
    setUnit(unitOption);
    setCount(1);
    if (!readOnly) onChange([1, unitOption]);
    setOpen(false);
  };

  const applyCustom = (countValue: number, maybeUnit?: DayInterval[1]) => {
    const safeUnit = maybeUnit && normalizedUnits.includes(maybeUnit) ? maybeUnit : defaultUnit;
    setIntervalSelection('custom');
    setUnit(safeUnit);
    setCount(countValue);
    if (!readOnly) onChange([countValue, safeUnit]);
  };

  const triggerLabel = intervalText || noneLabel;
  const triggerClasses = triggerClassName ?? "text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground cursor-pointer select-none flex items-center gap-1";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <div className={cn(triggerClasses, readOnly && "cursor-default")}>
          {triggerLabel}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0 overflow-hidden">
        <div className="flex flex-col p-1">
          {/* One-time option */}
          <button
            className={cn(
              "flex items-center w-full px-3 py-2 rounded-lg text-left text-sm font-medium",
              "transition-colors duration-150 hover:transition-none",
              effectiveSelection === 'one-time'
                ? "bg-foreground/[0.08] text-foreground"
                : "hover:bg-foreground/[0.04] text-foreground"
            )}
            onClick={selectOneTime}
          >
            {noneLabel}
          </button>

          {/* Fixed interval options */}
          {normalizedUnits.map((unitOption) => (
            <button
              key={unitOption}
              className={cn(
                "flex items-center w-full px-3 py-2 rounded-lg text-left text-sm font-medium",
                "transition-colors duration-150 hover:transition-none",
                effectiveSelection === unitOption
                  ? "bg-foreground/[0.08] text-foreground"
                  : "hover:bg-foreground/[0.04] text-foreground"
              )}
              onClick={() => selectFixed(unitOption)}
            >
              {buttonLabels[unitOption]}
            </button>
          ))}
        </div>

        {/* Custom interval option */}
        <div className="border-t border-border/30 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Custom</div>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              className={cn(
                "w-20 h-9 text-sm",
                "rounded-lg border border-border/60 dark:border-foreground/[0.1]",
                "bg-background dark:bg-[hsl(240,10%,10%)]"
              )}
              value={effectiveSelection === 'custom' ? count : 1}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val > 0) {
                  applyCustom(val, effectiveUnit);
                }
              }}
            />
            <Select
              value={effectiveUnit}
              onValueChange={(v) => {
                const newUnit = v as DayInterval[1];
                applyCustom(effectiveSelection === 'custom' ? count : 1, newUnit);
              }}
            >
              <SelectTrigger className={cn(
                "h-9 text-sm flex-1",
                "rounded-lg border border-border/60 dark:border-foreground/[0.1]",
                "bg-background dark:bg-[hsl(240,10%,10%)]"
              )}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {normalizedUnits.map((u) => (
                  <SelectItem key={u} value={u} className="text-sm">
                    {u}{count !== 1 ? 's' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
