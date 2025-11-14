import { cn } from "@/lib/utils";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
} from "@stackframe/stack-ui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { IntervalPopover } from "./components";
import { buildPriceUpdate, DEFAULT_INTERVAL_UNITS, freeTrialLabel, intervalLabel, Price, PRICE_INTERVAL_UNITS, Product } from "./utils";

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
  const savePriceUpdate = (overrides: Partial<ReturnType<typeof buildPriceUpdate>> = {}) => {
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
        "relative rounded-2xl border border-border/60 bg-muted/30 px-4 py-4",
        isEditing ? "flex flex-col gap-4" : "items-center justify-center text-center"
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
                        savePriceUpdate();
                      }}
                    />
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-semibold text-base text-muted-foreground">
                      $
                    </span>
                  </div>
                </div>

                {/* Billing Frequency */}
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
                      savePriceUpdate();
                    }}
                  />
                </div>

                {/* Free Trial */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center space-x-2 rounded-xl">
                    <Checkbox
                      id={`free-trial-enabled-${priceId}`}
                      checked={!!price.freeTrial}
                      onCheckedChange={(checked) => {
                        if (readOnly) return;
                        if (checked) {
                          savePriceUpdate({ freeTrial: [freeTrialCount || 7, freeTrialUnit || 'day'] });
                        } else {
                          savePriceUpdate({ freeTrial: undefined });
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
                          className="h-10 w-full rounded-xl border border-border bg-background text-right tabular-nums"
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
                          <SelectTrigger className="h-10 rounded-xl border border-border bg-background">
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
              className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
              onClick={onRemove}
              aria-label="Remove price"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        // View mode
        <>
          <div className="text-xl font-semibold tabular-nums">
            {isFree ? 'Free' : `$${niceAmount}`}
          </div>
          {!isFree && (
            <div className="text-xs text-muted-foreground capitalize">{intervalText ?? 'one-time'}</div>
          )}
          {includeByDefault && (
            <SimpleTooltip tooltip="Customers automatically receive this product when they are created">
              <div className="text-xs text-muted-foreground mt-1">
                Included by default
              </div>
            </SimpleTooltip>
          )}
          {!isFree && price.freeTrial && (
            <div className="text-xs text-muted-foreground mt-1">
              Free trial: {freeTrialLabel(price.freeTrial)}
            </div>
          )}
          {!isFree && price.serverOnly && (
            <div className="text-xs text-muted-foreground mt-1">
              Server only
            </div>
          )}
        </>
      )}
    </div>
  );
}
