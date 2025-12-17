import { cn } from "@/lib/utils";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@stackframe/stack-ui";
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
    <div className="flex items-center justify-center stack-scope mx-8">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-zinc-500">OR</div>
      <div className="flex-1">
        <Separator />
      </div>
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
          <CaretUpDownIcon className="h-4 w-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="flex flex-col gap-1">
          {/* One-time option */}
          <Button
            variant={effectiveSelection === 'one-time' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={selectOneTime}
          >
            {noneLabel}
          </Button>

          {/* Fixed interval options */}
          {normalizedUnits.map((unitOption) => (
            <Button
              key={unitOption}
              variant={effectiveSelection === unitOption ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start"
              onClick={() => selectFixed(unitOption)}
            >
              {buttonLabels[unitOption]}
            </Button>
          ))}

          {/* Custom interval option */}
          <Separator className="my-1" />
          <div className="px-2 py-1">
            <div className="text-xs font-medium text-muted-foreground mb-2">Custom</div>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className="w-20 h-8 text-xs"
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
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {normalizedUnits.map((u) => (
                    <SelectItem key={u} value={u} className="text-xs">
                      {u}{count !== 1 ? 's' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
