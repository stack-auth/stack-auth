"use client";

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
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { useState } from "react";

const DEFAULT_INTERVAL_UNITS: DayInterval[1][] = ['day', 'week', 'month', 'year'];

type IntervalSelection = 'one-time' | 'custom' | DayInterval[1];

export type RepeatingInputProps = {
  // Input value
  value: string,
  onValueChange: (value: string) => void,
  inputType?: 'text' | 'number',
  placeholder?: string,
  prefix?: string,
  inputClassName?: string,

  // Interval/frequency
  intervalSelection: IntervalSelection,
  intervalCount: number,
  intervalUnit?: DayInterval[1],
  onIntervalChange: (interval: DayInterval | null) => void,
  onIntervalSelectionChange: (selection: IntervalSelection) => void,
  onIntervalCountChange: (count: number) => void,
  onIntervalUnitChange: (unit: DayInterval[1] | undefined) => void,

  // Options
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
    <div className={cn("flex rounded-md border border-input focus-within:ring-1 focus-within:ring-ring", className)}>
      {/* Input field */}
      <div className="relative flex-1">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          type={inputType}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || readOnly}
          className={cn(
            "rounded-r-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0",
            prefix && "pl-7",
            inputClassName
          )}
        />
      </div>

      {/* Frequency dropdown button */}
      <Popover open={popoverOpen} onOpenChange={(isOpen) => !readOnly && !disabled && setPopoverOpen(isOpen)}>
        <PopoverTrigger asChild disabled={readOnly || disabled}>
          <button
            type="button"
            disabled={disabled || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 h-10 bg-muted/50 border-l border-input",
              "text-sm text-muted-foreground rounded-r-md",
              "hover:bg-muted hover:text-foreground",
              "focus:outline-none",
              "transition-colors duration-150 hover:transition-none",
              (disabled || readOnly) && "opacity-50 cursor-not-allowed pointer-events-none"
            )}
          >
            <span className="whitespace-nowrap">{triggerLabel}</span>
            <CaretUpDownIcon className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-0 overflow-hidden">
          <div className="flex flex-col p-1">
            {/* One-time option */}
            <button
              type="button"
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
                type="button"
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
                value={effectiveSelection === 'custom' ? intervalCount : 1}
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
                  applyCustom(effectiveSelection === 'custom' ? intervalCount : 1, newUnit);
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
                    <SelectItem key={u} value={u}>
                      {u}{(effectiveSelection === 'custom' ? intervalCount : 1) !== 1 ? 's' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

