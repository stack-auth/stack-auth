import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { InfoIcon, XIcon } from "@phosphor-icons/react";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { useEffect, useState } from "react";
import { IntervalPopover } from "./components";
import { buildPriceUpdate, DEFAULT_INTERVAL_UNITS, freeTrialLabel, intervalLabel, PRICE_INTERVAL_UNITS, Product } from "./utils";

/**
 * Label with optional info tooltip
 */
function LabelWithInfo({ children, tooltip }: { children: React.ReactNode, tooltip?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {children}
      </Label>
      {tooltip && (
        <SimpleTooltip tooltip={tooltip}>
          <InfoIcon className="h-3 w-3 text-muted-foreground/60 cursor-help" />
        </SimpleTooltip>
      )}
    </div>
  );
}

type ProductPriceRowProps = {
  priceId: string,
  price: (Product['prices'] & object)[string],
  includeByDefault: boolean,
  isFree: boolean,
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (newId: string | undefined, price: "include-by-default" | (Product['prices'] & object)[string]) => void,
  onRemove?: () => void,
  existingPriceIds: string[],
};

/**
 * Displays and edits a single price for a product
 * Handles both free prices (with include-by-default option) and paid prices
 */
export function ProductPriceRow({
  priceId,
  price,
  includeByDefault,
  isFree,
  readOnly,
  startEditing,
  onSave,
  onRemove,
  existingPriceIds,
}: ProductPriceRowProps) {
  // View/Edit mode
  const [isEditing, setIsEditing] = useState<boolean>(!!startEditing && !readOnly);

  // Price state
  const [amount, setAmount] = useState<string>(price.USD || '0.00');

  // Billing frequency state
  const [priceInterval, setPriceInterval] = useState<DayInterval[1] | undefined>(price.interval?.[1]);
  const [intervalCount, setIntervalCount] = useState<number>(price.interval?.[0] || 1);
  const [intervalSelection, setIntervalSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time'
  );

  // Free trial state
  const [freeTrialUnit, setFreeTrialUnit] = useState<DayInterval[1] | undefined>(price.freeTrial?.[1]);
  const [freeTrialCount, setFreeTrialCount] = useState<number>(price.freeTrial?.[0] || 7);
  const [freeTrialSelection, setFreeTrialSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    price.freeTrial ? (price.freeTrial[0] === 7 && price.freeTrial[1] === 'day' ? 'week' : price.freeTrial[0] === 1 ? price.freeTrial[1] : 'custom') : 'one-time'
  );

  const niceAmount = +amount;
  const intervalText = intervalLabel(price.interval);

  // Sync state when price changes externally
  useEffect(() => {
    if (isEditing) return;
    setAmount(price.USD || '0.00');
    setPriceInterval(price.interval?.[1]);
    setIntervalCount(price.interval?.[0] || 1);
    setIntervalSelection(price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time');
    setFreeTrialUnit(price.freeTrial?.[1]);
    setFreeTrialCount(price.freeTrial?.[0] || 7);
    setFreeTrialSelection(price.freeTrial ? (price.freeTrial[0] === 7 && price.freeTrial[1] === 'day' ? 'week' : price.freeTrial[0] === 1 ? price.freeTrial[1] : 'custom') : 'one-time');
  }, [price, isEditing]);

  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);

  // Helper to build and save price updates
  const savePriceUpdate = (overrides: Partial<Parameters<typeof buildPriceUpdate>[0]> = {}) => {
    if (readOnly) return;
    const updated = buildPriceUpdate({
      amount,
      serverOnly: !!price.serverOnly,
      intervalSelection,
      intervalCount,
      priceInterval,
      freeTrialSelection,
      freeTrialCount,
      freeTrialUnit,
      freeTrial: price.freeTrial,
      ...overrides,
    });
    onSave(undefined, updated);
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl px-4 py-4",
        isEditing
          ? "flex flex-col gap-4 border border-border/60 dark:border-foreground/[0.12] bg-background/60 dark:bg-[hsl(240,10%,7%)]"
          : "items-center justify-center text-center"
      )}
    >
      {isEditing ? (
        <>
          <div className="grid gap-4">
            {isFree ? (
              // Free price - show include by default option
              <div className="flex flex-col gap-4">
                <span className="text-xl font-semibold">Free</span>
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
              // Paid price - show full editor
              <>
                {/* Amount */}
                <div className="flex flex-col gap-1.5">
                  <LabelWithInfo tooltip="The price in USD that customers will pay">
                    Amount
                  </LabelWithInfo>
                  <div className="relative">
                    <Input
                      className={cn(
                        "h-10 w-full !pl-5 pr-3 text-base font-semibold tabular-nums",
                        "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                        "bg-background dark:bg-[hsl(240,10%,10%)]"
                      )}
                      tabIndex={0}
                      inputMode="decimal"
                      value={amount}
                      readOnly={false}
                      placeholder="eg. 9.99"
                      aria-label="Amount in USD"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || /^\d*(?:\.?\d{0,2})?$/.test(v)) {
                          setAmount(v);
                          // Pass the new amount directly since setState is async
                          savePriceUpdate({ amount: v });
                        }
                      }}
                    />
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-semibold text-base text-muted-foreground">
                      $
                    </span>
                  </div>
                </div>

                {/* Billing Frequency */}
                <div className="flex flex-col gap-1.5">
                  <LabelWithInfo tooltip="How often customers are charged (one-time for single purchases, or recurring for subscriptions)">
                    Billing Frequency
                  </LabelWithInfo>
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
                    triggerClassName={cn(
                      "flex h-10 w-full items-center justify-between px-3 text-sm font-medium capitalize text-foreground",
                      "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                      "bg-background dark:bg-[hsl(240,10%,10%)]",
                      "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.03]"
                    )}
                    onChange={(interval) => {
                      // Pass the new interval values directly since state updates are async
                      if (interval) {
                        savePriceUpdate({
                          intervalSelection: interval[0] === 1 ? interval[1] : 'custom',
                          intervalCount: interval[0],
                          priceInterval: interval[1],
                        });
                      } else {
                        savePriceUpdate({
                          intervalSelection: 'one-time',
                          intervalCount: 1,
                          priceInterval: undefined,
                        });
                      }
                    }}
                  />
                </div>

                {/* Free Trial */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center space-x-2 rounded-xl">
                    <Checkbox
                      id={`free-trial-enabled-${priceId}`}
                      checked={!!price.freeTrial}
                      onCheckedChange={(checked) => {
                        if (readOnly) return;
                        if (checked) {
                          savePriceUpdate({ freeTrial: [freeTrialCount || 7, freeTrialUnit || 'day'] });
                        } else {
                          // Pass null to explicitly remove free trial
                          savePriceUpdate({ freeTrial: null });
                        }
                      }}
                    />
                    <label
                      htmlFor={`free-trial-enabled-${priceId}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Free trial
                    </label>
                  </div>
                  {price.freeTrial && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-20">
                        <Input
                          className={cn(
                            "h-10 w-full text-right tabular-nums",
                            "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                            "bg-background dark:bg-[hsl(240,10%,10%)]"
                          )}
                          inputMode="numeric"
                          value={freeTrialCount}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!/^\d*$/.test(v)) return;
                            const n = v === '' ? 1 : parseInt(v, 10);
                            if (n === 0) return;
                            setFreeTrialCount(n);
                            savePriceUpdate({ freeTrial: [n, freeTrialUnit || 'day'] });
                          }}
                          placeholder="7"
                        />
                      </div>
                      <div className="flex-1">
                        <Select
                          value={freeTrialUnit || 'day'}
                          onValueChange={(u) => {
                            const newUnit = u as DayInterval[1];
                            setFreeTrialUnit(newUnit);
                            savePriceUpdate({ freeTrial: [freeTrialCount, newUnit] });
                          }}
                        >
                          <SelectTrigger className={cn(
                            "h-10",
                            "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                            "bg-background dark:bg-[hsl(240,10%,10%)]"
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEFAULT_INTERVAL_UNITS.map((unitOption) => (
                              <SelectItem key={unitOption} value={unitOption}>
                                {unitOption}{freeTrialCount !== 1 ? 's' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Server Only */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center space-x-2 rounded-xl">
                    <Checkbox
                      id={`server-only-${priceId}`}
                      checked={!!price.serverOnly}
                      onCheckedChange={(checked) => {
                        savePriceUpdate({ serverOnly: !!checked });
                      }}
                    />
                    <label
                      htmlFor={`server-only-${priceId}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Server only
                    </label>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Restricts this price to only be purchased from server-side calls
                  </div>
                </div>
              </>
            )}
          </div>

          {onRemove && (
            <button
              className="absolute right-3 top-3 p-1 rounded-md text-muted-foreground transition-colors duration-150 hover:transition-none hover:text-foreground hover:bg-foreground/[0.05]"
              onClick={onRemove}
              aria-label="Remove price"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        // View mode - minimal, centered display
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">
            {isFree ? 'Free' : `$${niceAmount}`}
          </div>
          {!isFree && (
            <div className="text-xs text-muted-foreground capitalize">{intervalText ?? 'One-time'}</div>
          )}
          {includeByDefault && (
            <div className="text-[11px] text-muted-foreground mt-1">Included by default</div>
          )}
          {!isFree && price.freeTrial && (
            <div className="mt-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20">
                {freeTrialLabel(price.freeTrial)} free trial
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
