"use client";

import { DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { useState } from "react";

const DEFAULT_INTERVAL_UNITS: DayInterval[1][] = ['day', 'week', 'month', 'year'];

type IntervalSelection = 'one-time' | 'custom' | DayInterval[1];

export type RepeatingInputProps = {
  value: string,
  onValueChange: (value: string) => void,
  inputType?: 'text' | 'number',
  placeholder?: string,
  prefix?: string,
  inputClassName?: string,

  intervalSelection: IntervalSelection,
  intervalCount: number,
  intervalUnit?: DayInterval[1],
  onIntervalChange: (interval: DayInterval | null) => void,
  onIntervalSelectionChange: (selection: IntervalSelection) => void,
  onIntervalCountChange: (count: number) => void,
  onIntervalUnitChange: (unit: DayInterval[1] | undefined) => void,

  allowedUnits?: DayInterval[1][],
  noneLabel?: string,
  useDurationLabels?: boolean,
  readOnly?: boolean,
  disabled?: boolean,
  className?: string,
};

function getIntervalLabel(
  intervalSelection: IntervalSelection,
  intervalCount: number,
  intervalUnit?: DayInterval[1],
  useDurationLabels = false
): string {
  if (intervalSelection === 'one-time') {
    return 'One-time';
  }

  const unit = intervalUnit || 'month';
  const count = intervalCount || 1;

  if (count === 1) {
    if (useDurationLabels) {
      return `1 ${unit}`;
    }
    const labels: Record<DayInterval[1], string> = {
      day: 'Daily',
      week: 'Weekly',
      month: 'Monthly',
      year: 'Yearly',
    };
    return labels[unit];
  }

  return `Every ${count} ${unit}s`;
}

export function RepeatingInput({
  value,
  onValueChange,
  inputType = 'text',
  placeholder,
  prefix,
  inputClassName,
  intervalSelection,
  intervalCount,
  intervalUnit,
  onIntervalChange,
  onIntervalSelectionChange,
  onIntervalCountChange,
  onIntervalUnitChange,
  allowedUnits,
  noneLabel = 'One-time',
  useDurationLabels = false,
  readOnly,
  disabled,
  className,
}: RepeatingInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const units = allowedUnits ?? DEFAULT_INTERVAL_UNITS;
  const normalizedUnits = units.length > 0 ? units : DEFAULT_INTERVAL_UNITS;
  const defaultUnit = (normalizedUnits[0] ?? 'month') as DayInterval[1];
  const effectiveUnit = intervalUnit && normalizedUnits.includes(intervalUnit) ? intervalUnit : defaultUnit;

  const isIntervalUnit = intervalSelection !== 'custom' && intervalSelection !== 'one-time';
  const effectiveSelection: IntervalSelection =
    isIntervalUnit && !normalizedUnits.includes(intervalSelection as DayInterval[1])
      ? 'custom'
      : intervalSelection;

  const buttonLabels: Record<DayInterval[1], string> = useDurationLabels ? {
    day: '1 day',
    week: '1 week',
    month: '1 month',
    year: '1 year',
  } : {
    day: 'Daily',
    week: 'Weekly',
    month: 'Monthly',
    year: 'Yearly',
  };

  const selectOneTime = () => {
    onIntervalSelectionChange('one-time');
    onIntervalUnitChange(undefined);
    onIntervalCountChange(1);
    if (!readOnly) onIntervalChange(null);
    setPopoverOpen(false);
  };

  const selectFixed = (unitOption: DayInterval[1]) => {
    if (!normalizedUnits.includes(unitOption)) return;
    onIntervalSelectionChange(unitOption);
    onIntervalUnitChange(unitOption);
    onIntervalCountChange(1);
    if (!readOnly) onIntervalChange([1, unitOption]);
    setPopoverOpen(false);
  };

  const applyCustom = (countValue: number, maybeUnit?: DayInterval[1]) => {
    const safeUnit = maybeUnit && normalizedUnits.includes(maybeUnit) ? maybeUnit : defaultUnit;
    onIntervalSelectionChange('custom');
    onIntervalUnitChange(safeUnit);
    onIntervalCountChange(countValue);
    if (!readOnly) onIntervalChange([countValue, safeUnit]);
  };

  const triggerLabel = getIntervalLabel(effectiveSelection, intervalCount, effectiveUnit, useDurationLabels);

  return (
    <div
      className={cn(
        "flex h-9 w-full items-stretch overflow-hidden rounded-xl",
        "border border-black/[0.08] dark:border-white/[0.06]",
        "bg-white/80 dark:bg-foreground/[0.03]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        "transition-all duration-150 hover:transition-none",
        "hover:bg-white dark:hover:bg-foreground/[0.06]",
        "focus-within:ring-1 focus-within:ring-foreground/[0.1]",
        (disabled || readOnly) && "opacity-60",
        className
      )}
    >
      {prefix && (
        <div className="flex items-center justify-center select-none px-3 text-sm text-muted-foreground/70 border-r border-black/[0.06] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02]">
          {prefix}
        </div>
      )}
      <input
        type={inputType}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
        className={cn(
          "min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground",
          "placeholder:text-muted-foreground/50",
          "focus:outline-none",
          "disabled:cursor-not-allowed",
          inputClassName
        )}
      />

      <Popover open={popoverOpen} onOpenChange={(isOpen) => !readOnly && !disabled && setPopoverOpen(isOpen)}>
        <PopoverTrigger asChild disabled={readOnly || disabled}>
          <button
            type="button"
            disabled={disabled || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 text-sm border-l border-black/[0.06] dark:border-white/[0.06]",
              "bg-black/[0.02] dark:bg-white/[0.02] text-muted-foreground",
              "hover:bg-foreground/[0.05] hover:text-foreground",
              "focus:outline-none focus-visible:bg-foreground/[0.06]",
              "transition-colors duration-150 hover:transition-none",
              (disabled || readOnly) && "opacity-50 cursor-not-allowed pointer-events-none"
            )}
          >
            <span className="whitespace-nowrap">{triggerLabel}</span>
            <CaretUpDownIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-60 p-0 overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/95 dark:bg-background/95 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] dark:ring-white/[0.06]"
        >
          <div className="flex flex-col p-1">
            <button
              type="button"
              className={cn(
                "flex items-center w-full px-2.5 py-2 rounded-lg text-left text-sm",
                "transition-colors duration-150 hover:transition-none",
                effectiveSelection === 'one-time'
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
              )}
              onClick={selectOneTime}
            >
              {noneLabel}
            </button>

            {normalizedUnits.map((unitOption) => (
              <button
                type="button"
                key={unitOption}
                className={cn(
                  "flex items-center w-full px-2.5 py-2 rounded-lg text-left text-sm",
                  "transition-colors duration-150 hover:transition-none",
                  effectiveSelection === unitOption
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                )}
                onClick={() => selectFixed(unitOption)}
              >
                {buttonLabels[unitOption]}
              </button>
            ))}
          </div>

          <div className="border-t border-black/[0.06] dark:border-white/[0.06] p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Custom</div>
            <div className="flex gap-2">
              <DesignInput
                type="number"
                min={1}
                size="sm"
                className="w-20"
                value={effectiveSelection === 'custom' ? intervalCount : 1}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) {
                    applyCustom(val, effectiveUnit);
                  }
                }}
              />
              <DesignSelectorDropdown
                value={effectiveUnit}
                onValueChange={(v) => {
                  const newUnit = v as DayInterval[1];
                  applyCustom(effectiveSelection === 'custom' ? intervalCount : 1, newUnit);
                }}
                options={normalizedUnits.map((u) => ({
                  value: u,
                  label: `${u}${(effectiveSelection === 'custom' ? intervalCount : 1) !== 1 ? 's' : ''}`,
                }))}
                size="sm"
                className="min-w-0 flex-1"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
