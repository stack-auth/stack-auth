"use client";

import { EditableGrid } from "@/components/editable-grid";
import { RepeatingInput } from "@/components/repeating-input";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui";
import { Clock, Server } from "lucide-react";
import { useState } from "react";
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

  const handleClose = () => {
    onEditingPriceChange(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleClose();
      } else {
        onOpenChange(isOpen);
      }
    }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isAdding ? "Add Price" : "Edit Price"}</DialogTitle>
          <DialogDescription>
            Configure the pricing option for this product.
          </DialogDescription>
        </DialogHeader>
        {editingPrice && (
          <div className="grid gap-4 py-4">
            {/* Amount with Billing Frequency */}
            <div className="grid gap-2">
              <Label>Price</Label>
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
              />
            </div>

            {/* Free Trial & Server Only as EditableGrid */}
            <EditableGrid
              columns={1}
              items={[
                // Free Trial
                {
                  type: 'custom' as const,
                  icon: <Clock size={16} />,
                  name: "Free Trial",
                  tooltip: "Free trial period before billing starts.",
                  children: (
                    <Popover
                      open={priceFreeTrialPopoverOpen}
                      onOpenChange={(popoverOpen) => {
                        setPriceFreeTrialPopoverOpen(popoverOpen);
                        if (popoverOpen) {
                          // Initialize popover state from editingPrice
                          setPriceFreeTrialCount(editingPrice.freeTrialCount);
                          setPriceFreeTrialUnit(editingPrice.freeTrialUnit);
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "w-full px-1 py-0 h-[unset] border-transparent rounded text-left text-foreground",
                            "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
                            "focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50",
                            "transition-colors duration-150 hover:transition-none"
                          )}
                        >
                          {editingPrice.freeTrialEnabled
                            ? `${editingPrice.freeTrialCount} ${editingPrice.freeTrialCount === 1 ? editingPrice.freeTrialUnit : editingPrice.freeTrialUnit + 's'}`
                            : 'None'}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Input
                              className="w-20"
                              type="number"
                              min={1}
                              value={priceFreeTrialCount}
                              onChange={(e) => setPriceFreeTrialCount(parseInt(e.target.value) || 1)}
                            />
                            <Select value={priceFreeTrialUnit} onValueChange={(v) => setPriceFreeTrialUnit(v as DayInterval[1])}>
                              <SelectTrigger className="w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DEFAULT_INTERVAL_UNITS.map((unit) => (
                                  <SelectItem key={unit} value={unit}>
                                    {unit}{priceFreeTrialCount !== 1 ? 's' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
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
                            </Button>
                            {editingPrice.freeTrialEnabled && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  onEditingPriceChange({ ...editingPrice, freeTrialEnabled: false });
                                  setPriceFreeTrialPopoverOpen(false);
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ),
                },
                // Server Only
                {
                  type: 'boolean' as const,
                  icon: <Server size={16} />,
                  name: "Server Only",
                  tooltip: "Server-only prices can only be assigned through server-side API calls.",
                  value: editingPrice.serverOnly,
                  onUpdate: async (value: boolean) => {
                    onEditingPriceChange({ ...editingPrice, serverOnly: value });
                  },
                },
              ]}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={editingPrice ? () => onSave(editingPrice, isAdding) : undefined}>
            {isAdding ? "Add Price" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

