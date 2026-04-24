"use client";

import { RepeatingInput } from "@/components/repeating-input";
import {
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import {
  cn,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { CaretUpDownIcon, ClockIcon, CurrencyDollarIcon, HardDriveIcon } from "@phosphor-icons/react";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useMemo, useState } from "react";
import { DEFAULT_INTERVAL_UNITS, PRICE_INTERVAL_UNITS, type Price } from "./utils";

export type EditingPrice = {
  priceId: string,
  amount: string,
  intervalSelection: 'one-time' | 'custom' | DayInterval[1],
  intervalCount: number,
  priceInterval: DayInterval[1] | undefined,
  freeTrialEnabled: boolean,
  freeTrialCount: number,
  freeTrialUnit: DayInterval[1],
  serverOnly: boolean,
};

type PriceEditDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  editingPrice: EditingPrice | null,
  onEditingPriceChange: (price: EditingPrice | null) => void,
  isAdding: boolean,
  onSave: (editing: EditingPrice, isNew: boolean) => void | Promise<void>,
};

export function PriceEditDialog({
  open,
  onOpenChange,
  editingPrice,
  onEditingPriceChange,
  isAdding,
  onSave,
}: PriceEditDialogProps) {
  const [priceFreeTrialPopoverOpen, setPriceFreeTrialPopoverOpen] = useState(false);
  const [priceFreeTrialCount, setPriceFreeTrialCount] = useState(7);
  const [priceFreeTrialUnit, setPriceFreeTrialUnit] = useState<DayInterval[1]>('day');

  const freeTrialUnitOptions = useMemo(
    () => DEFAULT_INTERVAL_UNITS.map((unit) => ({
      value: unit,
      label: `${unit}${priceFreeTrialCount !== 1 ? 's' : ''}`,
    })),
    [priceFreeTrialCount]
  );

  const handleClose = () => {
    onEditingPriceChange(null);
    onOpenChange(false);
  };

  const fieldTriggerClasses = cn(
    "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 text-sm",
    "border border-black/[0.08] dark:border-white/[0.06]",
    "bg-white/80 dark:bg-background/60 backdrop-blur-xl",
    "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
    "text-muted-foreground hover:text-foreground",
    "transition-all duration-150 hover:transition-none hover:ring-black/[0.12] dark:hover:ring-white/[0.1]",
    "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/30",
  );

  return (
    <DesignDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        } else {
          onOpenChange(isOpen);
        }
      }}
      size="md"
      icon={CurrencyDollarIcon}
      title={isAdding ? "Add Price" : "Edit Price"}
      description="Configure the pricing option for this product."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button">
              Cancel
            </DesignButton>
          </DesignDialogClose>
          <DesignButton
            size="sm"
            type="button"
            disabled={!editingPrice}
            onClick={() => {
              if (!editingPrice) return;
              runAsynchronouslyWithAlert(() => onSave(editingPrice, isAdding));
            }}
          >
            {isAdding ? "Add Price" : "Save Changes"}
          </DesignButton>
        </>
      )}
      bodyClassName="space-y-5"
    >
      {editingPrice && (
        <>
          <div className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</Label>
            <RepeatingInput
              value={editingPrice.amount}
              onValueChange={(v) => {
                if (v === '' || /^\d*(?:\.?\d{0,2})?$/.test(v)) {
                  onEditingPriceChange({ ...editingPrice, amount: v });
                }
              }}
              inputType="text"
              placeholder="9.99"
              prefix="$"
              intervalSelection={editingPrice.intervalSelection}
              intervalCount={editingPrice.intervalCount}
              intervalUnit={editingPrice.priceInterval}
              onIntervalChange={(interval) => {
                if (interval) {
                  onEditingPriceChange({
                    ...editingPrice,
                    intervalSelection: interval[0] === 1 ? interval[1] : 'custom',
                    intervalCount: interval[0],
                    priceInterval: interval[1],
                  });
                } else {
                  onEditingPriceChange({
                    ...editingPrice,
                    intervalSelection: 'one-time',
                    intervalCount: 1,
                    priceInterval: undefined,
                  });
                }
              }}
              onIntervalSelectionChange={(v) => onEditingPriceChange({ ...editingPrice, intervalSelection: v })}
              onIntervalCountChange={(v) => onEditingPriceChange({ ...editingPrice, intervalCount: v })}
              onIntervalUnitChange={(v) => onEditingPriceChange({ ...editingPrice, priceInterval: v })}
              allowedUnits={PRICE_INTERVAL_UNITS}
              className="rounded-xl border-black/[0.08] dark:border-white/[0.08] focus-within:ring-1 focus-within:ring-foreground/[0.1]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClockIcon size={12} />
                  <span>Free Trial</span>
                </div>
                <Popover
                  open={priceFreeTrialPopoverOpen}
                  onOpenChange={(popoverOpen) => {
                    setPriceFreeTrialPopoverOpen(popoverOpen);
                    if (popoverOpen) {
                      setPriceFreeTrialCount(editingPrice.freeTrialCount);
                      setPriceFreeTrialUnit(editingPrice.freeTrialUnit);
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button type="button" className={fieldTriggerClasses}>
                      <span className={cn("truncate", editingPrice.freeTrialEnabled && "text-foreground")}>
                        {editingPrice.freeTrialEnabled
                          ? `${editingPrice.freeTrialCount} ${editingPrice.freeTrialCount === 1 ? editingPrice.freeTrialUnit : editingPrice.freeTrialUnit + 's'}`
                          : 'None'}
                      </span>
                      <CaretUpDownIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-64 p-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/95 dark:bg-background/95 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] dark:ring-white/[0.06]"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DesignInput
                          className="w-20"
                          type="number"
                          min={1}
                          value={priceFreeTrialCount}
                          onChange={(e) => setPriceFreeTrialCount(parseInt(e.target.value) || 1)}
                          size="sm"
                        />
                        <DesignSelectorDropdown
                          value={priceFreeTrialUnit}
                          onValueChange={(v) => setPriceFreeTrialUnit(v as DayInterval[1])}
                          options={freeTrialUnitOptions}
                          size="sm"
                          className="flex-1"
                        />
                      </div>
                      <div className="flex gap-2">
                        <DesignButton
                          size="sm"
                          type="button"
                          className="flex-1"
                          onClick={() => {
                            onEditingPriceChange({
                              ...editingPrice,
                              freeTrialEnabled: true,
                              freeTrialCount: priceFreeTrialCount,
                              freeTrialUnit: priceFreeTrialUnit,
                            });
                            setPriceFreeTrialPopoverOpen(false);
                          }}
                        >
                          Save
                        </DesignButton>
                        {editingPrice.freeTrialEnabled && (
                          <DesignButton
                            size="sm"
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => {
                              onEditingPriceChange({ ...editingPrice, freeTrialEnabled: false });
                              setPriceFreeTrialPopoverOpen(false);
                            }}
                          >
                            Remove
                          </DesignButton>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <HardDriveIcon size={12} />
                  <span>Server Only</span>
                </div>
                <DesignSelectorDropdown
                  value={editingPrice.serverOnly ? 'true' : 'false'}
                  onValueChange={(v) => onEditingPriceChange({ ...editingPrice, serverOnly: v === 'true' })}
                  options={[
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' },
                  ]}
                  size="md"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </DesignDialog>
  );
}

/**
 * Creates an EditingPrice object from a Price
 */
export function priceToEditingPrice(priceId: string, price: Price): EditingPrice {
  return {
    priceId,
    amount: price.USD || '0.00',
    intervalSelection: price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time',
    intervalCount: price.interval?.[0] || 1,
    priceInterval: price.interval?.[1],
    freeTrialEnabled: !!price.freeTrial,
    freeTrialCount: price.freeTrial?.[0] || 7,
    freeTrialUnit: price.freeTrial?.[1] || 'day',
    serverOnly: !!price.serverOnly,
  };
}

/**
 * Creates a new EditingPrice with default values for adding
 */
export function createNewEditingPrice(priceId: string): EditingPrice {
  return {
    priceId,
    amount: '9.99',
    intervalSelection: 'month',
    intervalCount: 1,
    priceInterval: 'month',
    freeTrialEnabled: false,
    freeTrialCount: 7,
    freeTrialUnit: 'day',
    serverOnly: false,
  };
}

/**
 * Converts an EditingPrice back to a Price object
 */
export function editingPriceToPrice(editing: EditingPrice): Price {
  const interval: DayInterval | undefined = editing.intervalSelection === 'one-time'
    ? undefined
    : [editing.intervalCount, editing.priceInterval || 'month'];

  const freeTrial: DayInterval | undefined = editing.freeTrialEnabled
    ? [editing.freeTrialCount, editing.freeTrialUnit]
    : undefined;

  return {
    USD: editing.amount,
    serverOnly: !!editing.serverOnly,
    ...(interval && { interval }),
    ...(freeTrial && { freeTrial }),
  };
}
