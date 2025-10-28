"use client";

import { CodeBlock } from '@/components/code-block';
import { Link } from '@/components/link';
import { ItemDialog } from "@/components/payments/item-dialog";
import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { typedIncludes } from '@stackframe/stack-shared/dist/utils/arrays';
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { useQueryState } from '@stackframe/stack-shared/dist/utils/react';
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import {
  ActionDialog,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  SimpleTooltip,
  toast
} from "@stackframe/stack-ui";
import { ChevronDown, ChevronsUpDown, Gift, Layers, MoreVertical, Pencil, PencilIcon, Plus, Puzzle, Server, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAdminApp } from "../../use-admin-app";
import { ProductDialog } from "./product-dialog";

type Product = CompleteConfig['payments']['products'][keyof CompleteConfig['payments']['products']];
type Price = (Product['prices'] & object)[string];
type PricesObject = Exclude<Product['prices'], 'include-by-default'>;

const DEFAULT_INTERVAL_UNITS: DayInterval[1][] = ['day', 'week', 'month', 'year'];
const PRICE_INTERVAL_UNITS: DayInterval[1][] = ['week', 'month', 'year'];


function intervalLabel(tuple: DayInterval | undefined): string | null {
  if (!tuple) return null;
  const [count, unit] = tuple;
  if (count === 1) {
    return unit === 'year' ? 'yearly' : unit === 'month' ? 'monthly' : unit === 'week' ? 'weekly' : 'daily';
  }
  const plural = unit + 's';
  return `Every ${count} ${plural}`;
}


function shortIntervalLabel(interval: DayInterval | 'never'): string {
  if (interval === 'never') return 'once';
  const [count, unit] = interval;
  const map: Record<DayInterval[1], string> = { day: 'd', week: 'wk', month: 'mo', year: 'yr' };
  const suffix = map[unit];
  return `/${count === 1 ? '' : count}${suffix}`;
}

function OrSeparator() {
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

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}


function IntervalPopover({
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
}: {
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
}) {
  const [open, setOpen] = useState(false);
  const buttonLabels: Record<DayInterval[1], string> = {
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
          <ChevronsUpDown className="h-4 w-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="flex flex-col gap-1">
          <Button
            variant={effectiveSelection === 'one-time' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={selectOneTime}
          >
            {noneLabel}
          </Button>
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

          <Button
            variant={effectiveSelection === 'custom' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => {
              setIntervalSelection('custom');
              setUnit(effectiveUnit);
            }}
          >
            custom
          </Button>

          {effectiveSelection === 'custom' && (
            <div className="mt-2 px-1">
              <div className="text-xs text-muted-foreground mb-1">Custom</div>
              <div className="flex items-center gap-2">
                <div className="text-xs">every</div>
                <div className="w-14">
                  <Input
                    className="h-8 w-full text-right bg-transparent shadow-none font-mono text-xs"
                    inputMode="numeric"
                    value={String(count)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d*$/.test(v)) return;
                      const n = v === '' ? 0 : parseInt(v, 10);
                      applyCustom(n, effectiveUnit);
                    }}
                  />
                </div>
                <div className="w-24">
                  <Select
                    value={effectiveUnit}
                    onValueChange={(u) => {
                      const newUnit = u as DayInterval[1];
                      applyCustom(count, newUnit);
                    }}
                  >
                    <SelectTrigger className="h-8 w-full bg-transparent shadow-none text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {normalizedUnits.map((unitOption) => (
                        <SelectItem key={unitOption} value={unitOption}>
                          {unitOption}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


type ProductEditableInputProps = {
  value: string,
  onUpdate?: (value: string) => void,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  transform?: (value: string) => string,
};

function ProductEditableInput({
  value,
  onUpdate,
  readOnly,
  placeholder,
  inputClassName,
  transform,
}: ProductEditableInputProps) {
  const [isActive, setIsActive] = useState(false);

  if (readOnly) {
    return (
      <div
        className={cn(
          "w-full px-1 py-0 h-[unset] border-transparent bg-transparent cursor-default truncate",
          inputClassName,
          !value && "text-muted-foreground"
        )}
        aria-label={placeholder}
      >
        {value || placeholder}
      </div>
    );
  }

  return (
    <Input
      value={value}
      onChange={(event) => {
        const rawValue = event.target.value;
        const nextValue = transform ? transform(rawValue) : rawValue;
        onUpdate?.(nextValue);
      }}
      placeholder={placeholder}
      autoComplete="off"
      className={cn(
        "w-full px-1 py-0 h-[unset] border-transparent transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-transparent",
        isActive ? "bg-muted/60 dark:bg-muted/30 z-20" : "bg-transparent hover:bg-muted/40 dark:hover:bg-muted/20",
        inputClassName,
      )}
      onFocus={() => setIsActive(true)}
      onBlur={() => setIsActive(false)}
    />
  );
}


function ProductPriceRow({
  priceId,
  price,
  readOnly,
  includeByDefault,
  isFree,
  startEditing,
  onSave,
  onRemove,
  existingPriceIds,
}: {
  priceId: string,
  price: (Product['prices'] & object)[string],
  includeByDefault: boolean,
  isFree: boolean,
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (newId: string | undefined, price: "include-by-default" | (Product['prices'] & object)[string]) => void,
  onRemove?: () => void,
  existingPriceIds: string[],
}) {
  const [isEditing, setIsEditing] = useState<boolean>(!!startEditing && !readOnly);
  const [amount, setAmount] = useState<string>(price.USD || '0.00');
  const [priceInterval, setPriceInterval] = useState<DayInterval[1] | undefined>(price.interval?.[1]);
  const [intervalCount, setIntervalCount] = useState<number>(price.interval?.[0] || 1);
  const [intervalSelection, setIntervalSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time'
  );

  const niceAmount = +amount;

  useEffect(() => {
    if (isEditing) return;
    setAmount(price.USD || '0.00');
    setPriceInterval(price.interval?.[1]);
    setIntervalCount(price.interval?.[0] || 1);
    setIntervalSelection(price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time');
  }, [price, isEditing]);


  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);


  const intervalText = intervalLabel(price.interval);

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-border/60 bg-muted/30 px-4 py-4",
        isEditing ? "flex flex-col gap-4" : "items-center justify-center text-center"
      )}
    >
      {isEditing ? (
        <>
          <div className="grid gap-4">
            {isFree ? (
              <div className="flex flex-col gap-4">
                <span className="text-xl font-semibold">
                  Free
                </span>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center space-x-2 rounded-xl">
                    <Checkbox
                      id={`include-by-default-${priceId}`}
                      checked={includeByDefault}
                      onCheckedChange={(checked) => {
                        if (readOnly) return;
                        onSave(undefined, checked ? "include-by-default" : price);
                      }}
                    />
                    <label
                      htmlFor={`include-by-default-${priceId}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Include by default
                    </label>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    If enabled, customers get this product automatically when created
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    Amount
                  </Label>
                  <div className="relative">
                    <Input
                      className="h-10 w-full rounded-xl border border-border bg-background !pl-5 pr-3 text-base font-semibold tabular-nums"
                      tabIndex={0}
                      inputMode="decimal"
                      value={amount}
                      readOnly={false}
                      placeholder="eg. 9.99"
                      aria-label="Amount in USD"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || /^\d*(?:\.?\d{0,2})?$/.test(v)) setAmount(v);
                        if (!readOnly) {
                          const normalized = v === '' ? '0.00' : (Number.isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
                          const intervalObj = intervalSelection === 'one-time' ? undefined : ([
                            intervalSelection === 'custom' ? intervalCount : 1,
                          (intervalSelection === 'custom' ? (priceInterval || 'month') : intervalSelection) as DayInterval[1]
                          ] as DayInterval);
                          const updated: Price = {
                            USD: normalized,
                            serverOnly: !!price.serverOnly,
                            ...(intervalObj ? { interval: intervalObj } : {}),
                          };
                        onSave(undefined, updated);
                        }
                      }}
                    />
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-semibold text-base text-muted-foreground">
                      $
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    Billing Frequency
                  </Label>
                  <IntervalPopover
                    readOnly={readOnly}
                    intervalText={intervalText}
                    intervalSelection={intervalSelection}
                    unit={priceInterval}
                    count={intervalCount}
                    setIntervalSelection={setIntervalSelection}
                    setUnit={setPriceInterval}
                    setCount={setIntervalCount}
                    allowedUnits={PRICE_INTERVAL_UNITS}
                    triggerClassName="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3 text-sm font-medium capitalize text-foreground shadow-sm"
                    onChange={(interval) => {
                      if (readOnly) return;
                      const normalized = amount === '' ? '0.00' : (Number.isNaN(parseFloat(amount)) ? '0.00' : parseFloat(amount).toFixed(2));
                      const updated: Price = {
                        USD: normalized,
                        serverOnly: !!price.serverOnly,
                        ...(interval ? { interval } : {}),
                      };
                    onSave(undefined, updated);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {onRemove && (
            <button
              className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
              onClick={onRemove}
              aria-label="Remove price"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <div className="text-xl font-semibold tabular-nums">${niceAmount}</div>
          <div className="text-xs text-muted-foreground capitalize">{intervalText ?? 'one-time'}</div>
        </>
      )}
    </div>
  );
}

const EXPIRES_OPTIONS: Array<{ value: Product["includedItems"][string]["expires"], label: string, description: string }> = [
  {
    value: 'never' as const,
    label: 'Never expires',
    description: 'Items granted remain with the customer'
  },
  {
    value: 'when-purchase-expires' as const,
    label: 'When purchase expires',
    description: 'Items granted are removed when subscription ends'
  },
  {
    value: 'when-repeated' as const,
    label: 'When repeated',
    description: 'Items granted expire when they\'re granted again',
  }
];

function ProductItemRow({
  activeType,
  itemId,
  item,
  itemDisplayName,
  readOnly,
  startEditing,
  onSave,
  onRemove,
  allItems,
  existingIncludedItemIds,
  onChangeItemId,
  onCreateNewItem,
}: {
  activeType: 'user' | 'team' | 'custom',
  itemId: string,
  item: Product['includedItems'][string],
  itemDisplayName: string,
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (itemId: string, item: Product['includedItems'][string]) => void,
  onRemove?: () => void,
  allItems: Array<{ id: string, displayName: string, customerType: string }>,
  existingIncludedItemIds: string[],
  onChangeItemId: (newItemId: string) => void,
  onCreateNewItem: () => void,
}) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [quantity, setQuantity] = useState<string>(String(item.quantity));
  const [repeatUnit, setRepeatUnit] = useState<DayInterval[1] | undefined>(item.repeat !== 'never' ? item.repeat[1] : undefined);
  const [repeatCount, setRepeatCount] = useState<number>(item.repeat !== 'never' ? item.repeat[0] : 1);
  const [repeatSelection, setRepeatSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    item.repeat !== 'never' ? (item.repeat[0] === 1 ? item.repeat[1] : 'custom') : 'one-time'
  );
  const [itemSelectOpen, setItemSelectOpen] = useState(false);

  useEffect(() => {
    setQuantity(String(item.quantity));
    setRepeatUnit(item.repeat !== 'never' ? item.repeat[1] : undefined);
    setRepeatCount(item.repeat !== 'never' ? item.repeat[0] : 1);
    setRepeatSelection(item.repeat !== 'never' ? (item.repeat[0] === 1 ? item.repeat[1] : 'custom') : 'one-time');
  }, [item]);

  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);


  const updateParent = (raw: string) => {
    const normalized = raw === '' ? 0 : parseInt(raw, 10);
    const updated: Product['includedItems'][string] = { ...item, quantity: Number.isNaN(normalized) ? 0 : normalized };
    onSave(itemId, updated);
  };

  const repeatText = item.repeat === 'never' ? null : intervalLabel(item.repeat);
  const shortRepeatText = shortIntervalLabel(item.repeat);

  if (isEditing) {
    return (
      <div className="relative rounded-2xl border border-foreground bg-muted/30 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Item Name
            </Label>
            <Popover open={itemSelectOpen} onOpenChange={setItemSelectOpen}>
              <PopoverTrigger asChild>
                <button className="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3 text-sm font-medium">
                  <span className="truncate">{itemDisplayName}</span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <div className="flex max-h-64 flex-col gap-1 overflow-auto">
                  {allItems.map((opt) => {
                    const isSelected = opt.id === itemId;
                    const isUsed = existingIncludedItemIds.includes(opt.id) && !isSelected;
                    return (
                      <Button
                        key={opt.id}
                        variant={isSelected ? 'secondary' : 'ghost'}
                        size="sm"
                        className="justify-start text-left"
                        disabled={isUsed}
                        onClick={() => {
                          if (isSelected) {
                            setItemSelectOpen(false);
                            return;
                          }
                          if (isUsed) {
                            toast({ title: 'Item already included' });
                            return;
                          }
                          onChangeItemId(opt.id);
                          setItemSelectOpen(false);
                        }}
                      >
                        <div className="flex flex-col items-start">
                          <span>{opt.displayName || opt.id}</span>
                          <span className="text-xs text-muted-foreground">{opt.customerType.toUpperCase()} • {opt.id}</span>
                        </div>
                      </Button>
                    );
                  })}
                  <div className="mt-1 border-t pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-primary"
                      onClick={() => {
                        setItemSelectOpen(false);
                        onCreateNewItem();
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" /> New Item
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Quantity
            </Label>
            <Input
              className="h-10 w-full rounded-xl border border-border bg-background pr-3 text-right tabular-nums"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d*$/.test(v)) setQuantity(v);
                if (!readOnly && (v === '' || /^\d*$/.test(v))) updateParent(v);
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Purchase expires
            </Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3 text-sm font-medium">
                  <span className="truncate">
                    {item.expires === 'never'
                      ? 'Never expires'
                      : EXPIRES_OPTIONS.find(o => o.value === item.expires)?.label ?? 'Custom'}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="p-2">
                <div className="flex flex-col gap-2">
                  {EXPIRES_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} className="p-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex w-full flex-col items-start text-left"
                        onClick={() => {
                          onSave(itemId, { ...item, expires: option.value });
                        }}
                      >
                        {option.label}
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </Button>
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Repeat
            </Label>
            <IntervalPopover
              readOnly={readOnly}
              intervalText={repeatText}
              intervalSelection={repeatSelection}
              unit={repeatUnit}
              count={repeatCount}
              setIntervalSelection={setRepeatSelection}
              setUnit={setRepeatUnit}
              setCount={setRepeatCount}
              noneLabel="one time"
              triggerClassName="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3 text-sm font-medium capitalize"
              onChange={(interval) => {
                if (readOnly) return;
                const updated: Product['includedItems'][string] = {
                  ...item,
                  repeat: interval ? interval : 'never',
                };
                onSave(itemId, updated);
              }}
            />
          </div>
        </div>

        {onRemove && (
          <button
            className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
            onClick={onRemove}
            aria-label="Remove item"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  } else {
    return (
      <div className="flex flex-row">
        <div className="flex items-center gap-2 w-full">
          <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
            <div className="flex items-center gap-2 w-full">
              <CollapsibleTrigger asChild>
                <button className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted">
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
                </button>
              </CollapsibleTrigger >
              <div className="text-sm">{itemDisplayName}</div>
              <div className="ml-auto w-16 text-right text-sm text-muted-foreground tabular-nums">{prettyPrintWithMagnitudes(item.quantity)}</div>
              <div className="ml-2">
                <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{shortRepeatText}</div>
              </div>
              {
                !readOnly && (
                  <>
                    <button
                      className="ml-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setIsEditing(true)}
                      aria-label="Edit item"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {onRemove && (
                      <button className="text-destructive ml-1" onClick={onRemove} aria-label="Remove item">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </>
                )
              }
            </div >
            <CollapsibleContent>
              <div className="mt-2 space-y-2">
                <div className="text-xs pl-7 text-muted-foreground">{item.expires !== 'never' ? `Expires: ${String(item.expires).replace(/-/g, ' ')}` : 'Never expires'}</div>
                <div className="text-xs">
                  <CodeBlock
                    language="typescript"
                    content={`const item = await ${activeType === "user" ? "user" : "team"}.getItem("${itemId}");\nconst count = item.quantity;\n`}
                    title="Example"
                    icon="code"
                    compact
                    tooltip="Retrieves this item for the active customer and reads the current quantity they hold."
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible >
        </div >
      </div >
    );
  }
}


type ProductCardProps = {
  id: string,
  activeType: 'user' | 'team' | 'custom',
  product: Product,
  allProducts: Array<{ id: string, product: Product }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSave: (id: string, product: Product) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
  onDuplicate: (product: Product) => void,
  onCreateNewItem: () => void,
  onOpenDetails: (product: Product) => void,
  isDraft?: boolean,
  onCancelDraft?: () => void,
};

function ProductCard({ id, activeType, product, allProducts, existingItems, onSave, onDelete, onDuplicate, onCreateNewItem, onOpenDetails, isDraft, onCancelDraft }: ProductCardProps) {
  const [isEditing, setIsEditing] = useState(!!isDraft);
  const [draft, setDraft] = useState<Product>(product);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | undefined>(undefined);
  const [editingPricesIsFreeMode, setEditingPricesIsFreeMode] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const [localProductId, setLocalProductId] = useState<string>(id);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const hashAnchor = `#product-${id}`;
  const isHashTarget = currentHash === hashAnchor;

  useEffect(() => {
    setDraft(product);
    setLocalProductId(id);
  }, [product, id]);

  useEffect(() => {
    if (isDraft && !hasAutoScrolled && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
      setHasAutoScrolled(true);
    }
  }, [isDraft, hasAutoScrolled]);

  useEffect(() => {
    const updateFromHash = () => {
      if (window.location.hash === currentHash) return;
      setCurrentHash(window.location.hash);
    };
    updateFromHash();
    const interval = setInterval(() => updateFromHash(), 10);

    const removeHashTarget = () => {
      if (isHashTarget && window.location.hash === hashAnchor) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    window.addEventListener("click", removeHashTarget, { capture: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener("click", removeHashTarget, { capture: true });
    };
  }, [currentHash, hashAnchor, isHashTarget]);

  const getPricesObject = (draft: Product): PricesObject => {
    if (draft.prices === 'include-by-default') {
      return {
        "free": {
          USD: '0.00',
          serverOnly: false,
        },
      };
    }
    return draft.prices;
  };

  const pricesObject: PricesObject = getPricesObject(draft);
  const priceCount = Object.keys(pricesObject).length;
  const hasExistingPrices = priceCount > 0;

  useEffect(() => {
    setEditingPricesIsFreeMode(hasExistingPrices && (editingPricesIsFreeMode || draft.prices === 'include-by-default'));
  }, [editingPricesIsFreeMode, draft.prices, hasExistingPrices]);

  const canSaveProduct = draft.prices === 'include-by-default' || (typeof draft.prices === 'object' && hasExistingPrices);
  const saveDisabledReason = canSaveProduct ? undefined : "Add at least one price or set Include by default";

  const handleRemovePrice = (priceId: string) => {
    setDraft(prev => {
      const nextPrices: PricesObject = typeof prev.prices !== 'object' ? {} : { ...prev.prices };
      delete nextPrices[priceId];
      return { ...prev, prices: nextPrices };
    });
    if (editingPriceId === priceId) setEditingPriceId(undefined);
  };

  const handleAddOrEditIncludedItem = (itemId: string, item: Product['includedItems'][string]) => {
    setDraft(prev => ({
      ...prev,
      includedItems: {
        ...prev.includedItems,
        [itemId]: item,
      },
    }));
  };

  const handleRemoveIncludedItem = (itemId: string) => {
    setDraft(prev => {
      const next: Product['includedItems'] = { ...prev.includedItems };
      delete next[itemId];
      return { ...prev, includedItems: next };
    });
  };

  const renderPrimaryPrices = (mode: 'editing' | 'view') => {
    const entries = Object.entries(pricesObject);
    if (entries.length === 0) {
      return null;
    }
    return (
      <div className={cn(
        "shrink-0",
        mode === 'view' ? "space-y-3 text-center" : "flex flex-col gap-3"
      )}>
        {entries.map(([pid, price], index) => (
          <Fragment key={pid}>
            <ProductPriceRow
              key={pid}
              priceId={pid}
              price={price}
              isFree={editingPricesIsFreeMode}
              includeByDefault={draft.prices === 'include-by-default'}
              readOnly={mode !== 'editing'}
              startEditing={mode === 'editing'}
              existingPriceIds={entries.map(([k]) => k).filter(k => k !== pid)}
              onSave={(newId, newPrice) => {
                const finalId = newId || pid;
                setDraft(prev => {
                  if (newPrice === 'include-by-default') {
                    return { ...prev, prices: 'include-by-default' };
                  }
                  const prevPrices: PricesObject = getPricesObject(prev);
                  const nextPrices: PricesObject = { ...prevPrices };
                  if (newId && newId !== pid) {
                    if (Object.prototype.hasOwnProperty.call(nextPrices, newId)) {
                      toast({ title: "Price ID already exists" });
                      return prev; // Do not change state
                    }
                    delete nextPrices[pid];
                  }
                  nextPrices[finalId] = newPrice;
                  return { ...prev, prices: nextPrices };
                });
                if (editingPriceId && finalId === editingPriceId) {
                  setEditingPriceId(undefined);
                }
              }}
              onRemove={() => handleRemovePrice(pid)}
            />
            {((mode !== "view" && draft.prices !== "include-by-default") || index < entries.length - 1) && <OrSeparator />}
          </Fragment>
        ))}
      </div>
    );
  };

  const itemsList = Object.entries(draft.includedItems);

  const couldBeAddOnTo = allProducts.filter(o => o.product.catalogId === draft.catalogId && o.id !== id);
  const isAddOnTo = allProducts.filter(o => draft.isAddOnTo && o.id in draft.isAddOnTo);

  const PRODUCT_TOGGLE_OPTIONS = [{
    key: 'serverOnly' as const,
    label: 'Server only',
    description: "Restricts this product to only be purchased from server-side calls",
    active: !!draft.serverOnly,
    visible: true,
    icon: <Server size={16} />,
    onToggle: () => setDraft(prev => ({ ...prev, serverOnly: !prev.serverOnly })),
    wrapButton: (button: ReactNode) => button,
  }, {
    key: 'stackable' as const,
    label: 'Stackable',
    description: "Allow customers to purchase this product multiple times",
    active: !!draft.stackable,
    visible: true,
    icon: <Layers size={16} />,
    onToggle: () => setDraft(prev => ({ ...prev, stackable: !prev.stackable })),
    wrapButton: (button: ReactNode) => button,
  }, {
    key: 'addon' as const,
    label: 'Add-on',
    description: "Make this product an add-on. An add-on can be purchased along with the product(s) it is an add-on to.",
    visible: draft.isAddOnTo !== false || couldBeAddOnTo.length > 0,
    active: draft.isAddOnTo !== false,
    icon: <Puzzle size={16} />,
    onToggle: isAddOnTo.length === 0 && draft.isAddOnTo !== false ? () => setDraft(prev => ({ ...prev, isAddOnTo: false })) : undefined,
    wrapButton: (button: ReactNode) => isAddOnTo.length === 0 && draft.isAddOnTo !== false ? button : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {button}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {couldBeAddOnTo.map(product => (
            <DropdownMenuCheckboxItem
              checked={isAddOnTo.some(o => o.id === product.id)}
              key={product.id}
              onCheckedChange={(checked) => setDraft(prev => {
                const newIsAddOnTo = { ...prev.isAddOnTo || {} };
                if (checked) {
                  newIsAddOnTo[product.id] = true;
                } else {
                  delete newIsAddOnTo[product.id];
                }
                return { ...prev, isAddOnTo: Object.keys(newIsAddOnTo).length > 0 ? newIsAddOnTo : false };
              })}
              className="cursor-pointer"
            >
              {product.product.displayName} ({product.id})
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }] as const;

  const handleCancelEdit = () => {
    if (isDraft && onCancelDraft) {
      onCancelDraft();
      return;
    }
    setIsEditing(false);
    setDraft(product);
    setLocalProductId(id);
    setEditingPriceId(undefined);
  };

  const handleSaveEdit = async () => {
    const trimmed = localProductId.trim();
    const validId = trimmed && /^[a-z0-9-]+$/.test(trimmed) ? trimmed : id;
    if (validId !== id) {
      await onSave(validId, draft);
      await onDelete(id);
    } else {
      await onSave(id, draft);
    }
    setIsEditing(false);
    setEditingPriceId(undefined);
  };

  const renderToggleButtons = (mode: 'editing' | 'view') => {
    const getLabel = (b: typeof PRODUCT_TOGGLE_OPTIONS[number], editing: boolean) => {
      if (b.key === "addon" && isAddOnTo.length > 0) {
        return <span>
          Add-on to {isAddOnTo.map((o, i) => (
            <>
              {i > 0 && ", "}
              {editing ? o.product.displayName : (
                <Link className="underline hover:text-primary" href={`#product-${o.id}`}>
                  {o.product.displayName}
                </Link>
              )}
            </>
          ))}
        </span>;
      }
      return b.label;
    };
    return mode === 'editing' ? (
      PRODUCT_TOGGLE_OPTIONS
        .filter(b => b.visible !== false)
        .map((b) => {
          const wrap = b.wrapButton;
          return (
            <SimpleTooltip tooltip={b.description} key={b.key}>
              {wrap(
                <button
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    b.active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background/80 text-muted-foreground line-through"
                  )}
                  onClick={b.onToggle}
                >
                  {b.icon}
                  {getLabel(b, true)}
                </button>
              )}
            </SimpleTooltip>
          );
        })
    ) : (
      PRODUCT_TOGGLE_OPTIONS
        .filter(b => b.visible !== false)
        .filter(b => b.active)
        .map((b) => {
          return <span className="flex items-center gap-2 text-xs" key={b.key}>
            {b.icon}
            {getLabel(b, false)}
          </span>;
        })
    );
  };

  const editingContent = (
    <div className={cn("flex h-full flex-col rounded-3xl border border-border bg-background/95 shadow-lg transition-colors duration-600",
      isHashTarget && "border-primary shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
    )}>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <div className="text-xl font-semibold tracking-tight">
            {isDraft ? "New product" : "Edit product"}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Offer Name
            </Label>
            <Input
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
              value={draft.displayName || ""}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(prev => ({ ...prev, displayName: value }));
              }}
              placeholder="Offer name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Offer ID
            </Label>
            <SimpleTooltip tooltip={isDraft ? undefined : "Offer IDs cannot be changed after creation"}>
              <Input
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                value={localProductId}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
                    setLocalProductId(value);
                }}
                placeholder="offer-id"
                disabled={!isDraft}
              />
            </SimpleTooltip>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {renderToggleButtons('editing')}
        </div>

        <SectionHeading label="Prices" />
        <div className="flex flex-col gap-3">
          {renderPrimaryPrices('editing')}
          {!editingPricesIsFreeMode && (
            <div className="flex flex-row gap-4 items-center">
              <Button
                variant="outline"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/80 text-sm font-medium"
                onClick={() => {
                  const tempId = `price-${Date.now().toString(36).slice(2, 8)}`;
                  const newPrice: Price = { USD: '0.00', serverOnly: false };
                  setDraft(prev => {
                    const nextPrices: PricesObject = {
                      ...getPricesObject(prev),
                      [tempId]: newPrice,
                    };
                    return { ...prev, prices: nextPrices };
                  });
                  setEditingPriceId(tempId);
                }}
              >
                <Plus className="h-4 w-4" />
                {hasExistingPrices ? "Add alternative price" : "Add price"}
              </Button>
              {
                !hasExistingPrices && (
                  <>
                    <span className="text-sm text-muted-foreground">OR</span>
                    <Button
                      variant="outline"
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/80 text-sm font-medium"
                      onClick={() => {
                        setDraft(prev => ({ ...prev, prices: { free: { USD: '0.00', serverOnly: false } } }));
                        setEditingPricesIsFreeMode(true);
                      }}
                    >
                      <Gift className="h-4 w-4" />
                      Make free
                    </Button>
                  </>
                )
              }
            </div>
          )}
        </div>

        <SectionHeading label="Includes" />
        {itemsList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 py-6 text-center text-sm text-muted-foreground">
            No items yet
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {itemsList.map(([itemId, item]) => {
              const itemMeta = existingItems.find(i => i.id === itemId);
              const itemLabel = itemMeta ? itemMeta.id : 'Select item';
              return (
                <ProductItemRow
                  key={itemId}
                  activeType={activeType}
                  itemId={itemId}
                  item={item}
                  itemDisplayName={itemLabel}
                  allItems={existingItems}
                  existingIncludedItemIds={Object.keys(draft.includedItems).filter(id => id !== itemId)}
                  startEditing={true}
                  readOnly={false}
                  onSave={(id, updated) => handleAddOrEditIncludedItem(id, updated)}
                  onChangeItemId={(newItemId) => {
                    setDraft(prev => {
                      if (Object.prototype.hasOwnProperty.call(prev.includedItems, newItemId)) {
                        toast({ title: "Item already included" });
                        return prev;
                      }
                      const next: Product['includedItems'] = { ...prev.includedItems };
                      const value = next[itemId];
                      delete next[itemId];
                      next[newItemId] = value;
                      return { ...prev, includedItems: next };
                    });
                  }}
                  onRemove={() => handleRemoveIncludedItem(itemId)}
                  onCreateNewItem={onCreateNewItem}
                />
              );
            })}
          </div>
        )}
        <Button
          variant="outline"
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/80 text-sm font-medium"
          onClick={() => {
            const available = existingItems.find(i => !Object.prototype.hasOwnProperty.call(draft.includedItems, i.id));
            const newItemId = available?.id || `__new_item__${Date.now().toString(36).slice(2, 8)}`;
            const newItem: Product['includedItems'][string] = { quantity: 1, repeat: 'never', expires: 'never' };
            setDraft(prev => ({
              ...prev,
              includedItems: {
                ...prev.includedItems,
                [newItemId]: newItem,
              }
            }));
          }}
        >
          <Plus className="h-4 w-4" />
          Add Item
        </Button>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => {
              if (isDraft && onCancelDraft) {
                onCancelDraft();
              } else {
                setShowDeleteDialog(true);
              }
            }}
            aria-label="Delete offer"
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              className="rounded-xl px-4"
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
            <SimpleTooltip tooltip={saveDisabledReason} disabled={canSaveProduct}>
              <Button
                className="h-10 rounded-xl px-6"
                disabled={!canSaveProduct}
                onClick={async () => { await handleSaveEdit(); }}
              >
                Save
              </Button>
            </SimpleTooltip>
          </div>
        </div>
      </div>
    </div>
  );

  const viewingContent = (
    <div className={cn("group relative flex flex-col rounded-2xl border bg-background pb-4 transition-colors",
      isHashTarget && "border-primary shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
    )}>
      <div className="flex flex-col items-center justify-center px-4 pt-4">
        <div className="flex w-full flex-col items-center justify-center gap-0.5">
          <ProductEditableInput
            value={localProductId}
            onUpdate={(value) => setLocalProductId(value)}
            readOnly
            placeholder={"Product ID"}
            inputClassName="text-xs font-mono text-center text-muted-foreground"
            transform={(value) => value.toLowerCase()}
          />
          <ProductEditableInput
            value={draft.displayName || ""}
            onUpdate={(value) => setDraft(prev => ({ ...prev, displayName: value }))}
            readOnly
            placeholder={"Product display name"}
            inputClassName="text-lg font-bold text-center w-full"
          />
        </div>
        <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
            aria-label="Edit product"
            onClick={() => {
              setIsEditing(true);
              setDraft(product);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted" aria-label="Open menu">
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => {
                setIsEditing(true);
                setDraft(product);
              }}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { onDuplicate(product); }}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setShowDeleteDialog(true); }}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 px-4 pb-3 pt-1 text-muted-foreground">
        {renderToggleButtons('view')}
      </div>
      <div className="border-y border-border px-4 py-4">
        {renderPrimaryPrices('view')}
      </div>

      <div className="px-4 py-3">
        {itemsList.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">No items yet</div>
        ) : (
          <div className="space-y-2">
            {itemsList.map(([itemId, item]) => {
              const itemMeta = existingItems.find(i => i.id === itemId);
              const itemLabel = itemMeta ? itemMeta.id : 'Select item';
              return (
                <ProductItemRow
                  key={itemId}
                  activeType={activeType}
                  itemId={itemId}
                  item={item}
                  itemDisplayName={itemLabel}
                  allItems={existingItems}
                  existingIncludedItemIds={Object.keys(draft.includedItems).filter(id => id !== itemId)}
                  startEditing={false}
                  readOnly
                  onSave={(id, updated) => handleAddOrEditIncludedItem(id, updated)}
                  onChangeItemId={(_newItemId) => { }}
                  onRemove={undefined}
                  onCreateNewItem={onCreateNewItem}
                />
              );
            })}
          </div>
        )}
      </div>
      {activeType !== "custom" && (
        <div className="border-t p-4">
          <CodeBlock
            language="typescript"
            content={`const checkoutUrl = await ${activeType === "user" ? "user" : "team"}.createCheckoutUrl({ productId: "${id}" });\nwindow.open(checkoutUrl, "_blank");`}
            title="Checkout"
            icon="code"
            compact
            tooltip="Creates a checkout URL for this product and opens it so the customer can finish their purchase."
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={cardRef}
      id={`product-${id}`}
      className={cn(
        "shrink-0 transition-all",
        isEditing ? "w-[420px]" : "w-[320px]"
      )}
    >
      {isEditing ? editingContent : viewingContent}

      <ActionDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete product"
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            await onDelete(id);
            setShowDeleteDialog(false);
          }
        }}
        cancelButton
      >
        Are you sure you want to delete this product?
      </ActionDialog>
    </div >
  );
}

type CatalogViewProps = {
  groupedProducts: Map<string | undefined, Array<{ id: string, product: Product }>>,
  groups: Record<string, { displayName?: string }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSaveProduct: (id: string, product: Product) => Promise<void>,
  onDeleteProduct: (id: string) => Promise<void>,
  onCreateNewItem: () => void,
  onOpenProductDetails: (product: Product) => void,
  onSaveProductWithGroup: (catalogId: string, productId: string, product: Product) => Promise<void>,
  createDraftRequestId?: string,
  draftCustomerType: 'user' | 'team' | 'custom',
  onDraftHandled?: () => void,
};

function CatalogView({ groupedProducts, groups, existingItems, onSaveProduct, onDeleteProduct, onCreateNewItem, onOpenProductDetails, onSaveProductWithGroup, createDraftRequestId, draftCustomerType, onDraftHandled }: CatalogViewProps) {
  const [activeTypeUnfiltered, setActiveType] = useQueryState('catalog_type', 'user');
  const activeType = typedIncludes(['user', 'team', 'custom'] as const, activeTypeUnfiltered) ? activeTypeUnfiltered : 'user';
  const [drafts, setDrafts] = useState<Array<{ key: string, catalogId: string | undefined, product: Product }>>([]);
  const [creatingGroupKey, setCreatingGroupKey] = useState<string | undefined>(undefined);
  const [newCatalogId, setNewCatalogId] = useState("");
  const newGroupInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const res = new Map<string | undefined, Array<{ id: string, product: Product }>>();
    groupedProducts.forEach((products, gid) => {
      const f = products.filter(o => o.product.customerType === activeType);
      if (f.length) res.set(gid, f);
    });
    return res;
  }, [groupedProducts, activeType]);

  useEffect(() => {
    if (creatingGroupKey && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
      newGroupInputRef.current.select();
    }
  }, [creatingGroupKey]);

  // If user switches tabs while creating a new catalog, remove the temporary group and its drafts
  const prevActiveTypeRef = useRef(activeType);
  useEffect(() => {
    const tabChanged = prevActiveTypeRef.current !== activeType;
    prevActiveTypeRef.current = activeType;
    if (!tabChanged) return;
    if (!creatingGroupKey) return;
    setDrafts(prev => prev.filter(d => d.catalogId !== creatingGroupKey));
    setCreatingGroupKey(undefined);
    setNewCatalogId("");
  }, [activeType, creatingGroupKey]);


  const usedIds = useMemo(() => {
    const all: string[] = [];
    groupedProducts.forEach(arr => arr.forEach(({ id }) => all.push(id)));
    drafts.forEach(d => all.push(d.key));
    return new Set(all);
  }, [groupedProducts, drafts]);
  const lastHandledDraftRequestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!createDraftRequestId) return;
    if (lastHandledDraftRequestRef.current === createDraftRequestId) return;

    lastHandledDraftRequestRef.current = createDraftRequestId;

    let candidate = "product";
    let counter = 2;
    while (usedIds.has(candidate)) {
      candidate = `product-${counter++}`;
    }

    const newProduct: Product = {
      displayName: 'New Product',
      customerType: draftCustomerType,
      catalogId: undefined,
      isAddOnTo: false,
      stackable: false,
      prices: {},
      includedItems: {},
      serverOnly: false,
      freeTrial: undefined,
    };

    setActiveType(draftCustomerType);
    setDrafts((prev) => [...prev, { key: candidate, catalogId: undefined, product: newProduct }]);
    onDraftHandled?.();
  }, [createDraftRequestId, draftCustomerType, onDraftHandled, usedIds, setActiveType]);

  const generateProductId = (base: string) => {
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    return id;
  };

  const catalogIdsToRender = useMemo(() => {
    const s = new Set<string | undefined>();
    filtered.forEach((_products, gid) => s.add(gid));
    const arr = Array.from(s.values());
    const withoutUndefined = arr.filter((gid): gid is string => gid !== undefined);
    const ordered: Array<string | undefined> = [...withoutUndefined, undefined];
    return creatingGroupKey ? [creatingGroupKey, ...ordered] : ordered;
  }, [filtered, creatingGroupKey]);

  return (
    <div className="space-y-10">
      <div className="flex items-center">
        <div className="inline-flex rounded-md bg-muted p-1">
          {(['user', 'team', 'custom'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={cn(
                "px-4 py-2 text-sm rounded-sm capitalize",
                activeType === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t} catalogs
            </button>
          ))}
        </div>
      </div>

      {catalogIdsToRender.map((catalogId) => {
        const isNewGroupPlaceholder = !!creatingGroupKey && catalogId === creatingGroupKey;
        const products = isNewGroupPlaceholder ? [] : (filtered.get(catalogId) || []);
        const groupName = !isNewGroupPlaceholder ? (catalogId ? ((groups[catalogId].displayName || catalogId)) : 'No catalog') : '';
        return (
          <div key={catalogId || 'ungrouped'}>
            {isNewGroupPlaceholder ? (
              <div className="mb-3 flex items-center gap-2">
                <Input
                  ref={newGroupInputRef}
                  value={newCatalogId}
                  onChange={(e) => {
                    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
                    setNewCatalogId(value);
                  }}
                  placeholder="catalog-id"
                  className="w-56"
                />
                <button
                  className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted"
                  onClick={() => {
                    setCreatingGroupKey(undefined);
                    setNewCatalogId("");
                    setDrafts(prev => prev.filter(d => d.catalogId !== catalogId));
                  }}
                  aria-label="Cancel new catalog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h3 className="text-lg font-semibold mb-3">{groupName}</h3>
            )}
            <div className="relative rounded-xl bg-slate-100 dark:bg-muted border-slate-100 dark:border-muted border-2">
              <div className="flex gap-4 justify-start overflow-x-auto p-4 min-h-20 pr-16">
                <div className="flex max-w-max gap-4 items-start">
                  {products.map(({ id, product }) => (
                    <ProductCard
                      key={id}
                      id={id}
                      activeType={activeType}
                      product={product}
                      allProducts={products}
                      existingItems={existingItems}
                      onSave={onSaveProduct}
                      onDelete={onDeleteProduct}
                      onDuplicate={(srcProduct) => {
                        const key = generateProductId("product");
                        const duplicated: Product = {
                          ...srcProduct,
                          displayName: `${srcProduct.displayName || id} Copy`,
                        };
                        setDrafts(prev => [...prev, { key, catalogId, product: duplicated }]);
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenProductDetails(o)}
                    />
                  ))}
                  {drafts.filter(d => d.catalogId === catalogId && d.product.customerType === activeType).map((d) => (
                    <ProductCard
                      key={d.key}
                      id={d.key}
                      activeType={activeType}
                      product={d.product}
                      allProducts={products}
                      existingItems={existingItems}
                      isDraft
                      onSave={async (_ignoredId, product) => {
                        const newId = generateProductId('product');
                        if (isNewGroupPlaceholder) {
                          const id = newCatalogId.trim();
                          if (!id) {
                            alert("Catalog ID is required");
                            return;
                          }
                          if (!/^[a-z0-9-]+$/.test(id)) {
                            alert("Catalog ID must be lowercase letters, numbers, and hyphens");
                            return;
                          }
                          if (Object.prototype.hasOwnProperty.call(groups, id)) {
                            alert("Catalog ID already exists");
                            return;
                          }
                          const productWithGroup: Product = { ...product, catalogId: id };
                          await onSaveProductWithGroup(id, newId, productWithGroup);
                          setCreatingGroupKey(undefined);
                          setNewCatalogId("");
                          setDrafts(prev => prev.filter(x => x.key !== d.key));
                          return;
                        }
                        await onSaveProduct(newId, product);
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDelete={async () => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                        if (isNewGroupPlaceholder) {
                          setCreatingGroupKey(undefined);
                          setNewCatalogId("");
                        }
                      }}
                      onDuplicate={() => {
                        const cloneKey = `${d.key}-copy`;
                        setDrafts(prev => ([...prev, { key: cloneKey, catalogId: d.catalogId, product: { ...d.product, displayName: `${d.product.displayName} Copy` } }]));
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenProductDetails(o)}
                      onCancelDraft={() => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                        if (isNewGroupPlaceholder) {
                          setCreatingGroupKey(undefined);
                          setNewCatalogId("");
                        }
                      }}
                    />
                  ))}
                  {!isNewGroupPlaceholder && (
                    <Button
                      variant="outline"
                      size="plain"
                      className="self-stretch border border-dashed rounded-xl w-[320px] py-32 flex flex-col items-center justify-center bg-background"
                      onClick={() => {
                        const key = generateProductId("product");
                        const newProduct: Product = {
                          displayName: 'New Product',
                          customerType: activeType,
                          catalogId: catalogId || undefined,
                          isAddOnTo: false,
                          stackable: false,
                          prices: {},
                          includedItems: {},
                          serverOnly: false,
                          freeTrial: undefined,
                        };
                        setDrafts(prev => [...prev, { key, catalogId, product: newProduct }]);
                      }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Plus className="h-8 w-8" />
                        Create product
                      </div>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="plain"
        className="w-full h-40 flex items-center justify-center border border-dashed rounded-xl"
        onClick={() => {
          const tempKey = `__new_catalog__${Date.now().toString(36).slice(2, 8)}`;
          setCreatingGroupKey(tempKey);
          setNewCatalogId("");
          const draftKey = generateProductId("product");
          const newProduct: Product = {
            displayName: 'New Product',
            customerType: activeType,
            catalogId: tempKey,
            isAddOnTo: false,
            stackable: false,
            prices: {},
            includedItems: {},
            serverOnly: false,
            freeTrial: undefined,
          };
          setDrafts(prev => [...prev, { key: draftKey, catalogId: tempKey, product: newProduct }]);
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <Plus className="h-8 w-8" />
          Create catalog
        </div>
      </Button>
    </div>
  );
}

type CatalogViewPageProps = {
  createDraftRequestId?: string,
  draftCustomerType?: 'user' | 'team' | 'custom',
  onDraftHandled?: () => void,
};

export default function PageClient({ createDraftRequestId, draftCustomerType = 'user', onDraftHandled }: CatalogViewPageProps) {
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: string, displayName: string, customerType: 'user' | 'team' | 'custom' } | null>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig: CompleteConfig['payments'] = config.payments;


  // Group products by catalogId and sort by customer type priority
  const groupedProducts = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, product: Product }>>();

    // Group products
    for (const [id, product] of typedEntries(paymentsConfig.products)) {
      const catalogId = product.catalogId;
      if (!groups.has(catalogId)) {
        groups.set(catalogId, []);
      }
      groups.get(catalogId)!.push({ id, product });
    }

    // Sort products within each group by customer type, then by ID
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    groups.forEach((products) => {
      products.sort((a, b) => {
        const priorityA = customerTypePriority[a.product.customerType as keyof typeof customerTypePriority] || 4;
        const priorityB = customerTypePriority[b.product.customerType as keyof typeof customerTypePriority] || 4;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // If same customer type, sort addons last
        if (a.product.isAddOnTo !== b.product.isAddOnTo) {
          return a.product.isAddOnTo ? 1 : -1;
        }
        // If same customer type and addons, sort by lowest price
        const getPricePriority = (product: Product) => {
          if (product.prices === 'include-by-default') return 0;
          if (typeof product.prices !== 'object') return 0;
          return Math.min(...Object.values(product.prices).map(price => +(price.USD ?? Infinity)));
        };
        const priceA = getPricePriority(a.product);
        const priceB = getPricePriority(b.product);
        if (priceA !== priceB) {
          return priceA - priceB;
        }
        // Otherwise, sort by ID
        return stringCompare(a.id, b.id);
      });
    });

    // Sort groups by their predominant customer type
    const sortedGroups = new Map<string | undefined, Array<{ id: string, product: Product }>>();

    // Helper to get group priority
    const getGroupPriority = (catalogId: string | undefined) => {
      if (!catalogId) return 999; // Ungrouped always last

      const products = groups.get(catalogId) || [];
      if (products.length === 0) return 999;

      // Get the most common customer type in the group
      const typeCounts = products.reduce((acc, { product }) => {
        const type = product.customerType;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Find predominant type
      const predominantType = Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0];

      return customerTypePriority[predominantType as keyof typeof customerTypePriority] || 4;
    };

    // Sort group entries
    const sortedEntries = Array.from(groups.entries()).sort(([aId], [bId]) => {
      const priorityA = getGroupPriority(aId);
      const priorityB = getGroupPriority(bId);
      return priorityA - priorityB;
    });

    // Rebuild map in sorted order
    sortedEntries.forEach(([catalogId, products]) => {
      sortedGroups.set(catalogId, products);
    });

    return sortedGroups;
  }, [paymentsConfig]);

  // Handler for create item button
  const handleCreateItem = () => {
    setShowItemDialog(true);
  };

  // Handler for saving product
  const handleSaveProduct = async (productId: string, product: Product) => {
    await project.updateConfig({ [`payments.products.${productId}`]: product });
    setShowProductDialog(false);
    toast({ title: editingProduct ? "Product updated" : "Product created" });
  };

  // Handler for saving item
  const handleSaveItem = async (item: { id: string, displayName: string, customerType: 'user' | 'team' | 'custom' }) => {
    await project.updateConfig({ [`payments.items.${item.id}`]: { displayName: item.displayName, customerType: item.customerType } });
    setShowItemDialog(false);
    setEditingItem(null);
    toast({ title: editingItem ? "Item updated" : "Item created" });
  };

  // Prepare data for product dialog - update when items change
  const existingProductsList = typedEntries(paymentsConfig.products).map(([id, product]) => ({
    id,
    displayName: product.displayName,
    catalogId: product.catalogId,
    customerType: product.customerType
  }));

  const existingItemsList = typedEntries(paymentsConfig.items).map(([id, item]) => ({
    id,
    displayName: item.displayName,
    customerType: item.customerType
  }));

  const handleInlineSaveProduct = async (productId: string, product: Product) => {
    await project.updateConfig({ [`payments.products.${productId}`]: product });
    toast({ title: "Product updated" });
  };

  const handleDeleteProduct = async (productId: string) => {
    await project.updateConfig({ [`payments.products.${productId}`]: null });
    toast({ title: "Product deleted" });
  };

  const innerContent = (
    <div className="flex-1">
      <CatalogView
        groupedProducts={groupedProducts}
        groups={paymentsConfig.catalogs}
        existingItems={existingItemsList}
        onSaveProduct={handleInlineSaveProduct}
        onDeleteProduct={handleDeleteProduct}
        onCreateNewItem={handleCreateItem}
        onOpenProductDetails={(product) => {
          setEditingProduct(product);
          setShowProductDialog(true);
        }}
        onSaveProductWithGroup={async (catalogId, productId, product) => {
          await project.updateConfig({
            [`payments.catalogs.${catalogId}`]: {},
            [`payments.products.${productId}`]: product,
          });
          toast({ title: "Product created" });
        }}
        createDraftRequestId={createDraftRequestId}
        draftCustomerType={draftCustomerType}
        onDraftHandled={onDraftHandled}
      />
    </div>
  );

  return (
    <>
      {innerContent}

      {/* Product Dialog */}
      <ProductDialog
        open={showProductDialog}
        onOpenChange={(open) => {
          setShowProductDialog(open);
          if (!open) {
            setEditingProduct(null);
          }
        }}
        onSave={async (productId, product) => await handleSaveProduct(productId, product)}
        editingProduct={editingProduct ?? undefined}
        existingProducts={existingProductsList}
        existingCatalogs={Object.fromEntries(Object.entries(paymentsConfig.catalogs).map(([id, g]) => [id, { displayName: g.displayName || id }]))}
        existingItems={existingItemsList}
        onCreateNewItem={handleCreateItem}
      />

      {/* Item Dialog */}
      <ItemDialog
        open={showItemDialog}
        onOpenChange={(open) => {
          setShowItemDialog(open);
          if (!open) {
            setEditingItem(null);
          }
        }}
        onSave={async (item) => await handleSaveItem(item)}
        editingItem={editingItem ?? undefined}
        existingItemIds={Object.keys(paymentsConfig.items)}
      />
    </>
  );
}
