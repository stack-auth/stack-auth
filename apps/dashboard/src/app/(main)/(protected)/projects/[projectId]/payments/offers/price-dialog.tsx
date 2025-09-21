"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' }
];

type Offer = CompleteConfig['payments']['offers'][string];
type IncludedItem = Offer['includedItems'][string];
type Price = (Offer['prices'] & object)[string];

type PriceDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (priceId: string, price: Price) => void,
  editingPriceId?: string,
  editingPrice?: Price,
  existingPriceIds?: string[],
};

export function PriceDialog({
  open,
  onOpenChange,
  onSave,
  editingPriceId,
  editingPrice,
  existingPriceIds = []
}: PriceDialogProps) {
  const [priceId, setPriceId] = useState(editingPriceId || "");
  const [amount, setAmount] = useState(editingPrice?.USD || "");
  const [isRecurring, setIsRecurring] = useState(!!editingPrice?.interval);
  const [intervalCount, setIntervalCount] = useState(editingPrice?.interval?.[0]?.toString() || "1");
  const [intervalUnit, setIntervalUnit] = useState<'day' | 'week' | 'month' | 'year'>(editingPrice?.interval?.[1] || "month");
  const [hasFreeTrial, setHasFreeTrial] = useState(!!editingPrice?.freeTrial);
  const [freeTrialCount, setFreeTrialCount] = useState(editingPrice?.freeTrial?.[0]?.toString() || "7");
  const [freeTrialUnit, setFreeTrialUnit] = useState<'day' | 'week' | 'month' | 'year'>(editingPrice?.freeTrial?.[1] || "day");
  const [serverOnly, setServerOnly] = useState(editingPrice?.serverOnly || false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateAndSave = () => {
    const newErrors: Record<string, string> = {};

    // Validate price ID
    if (!priceId.trim()) {
      newErrors.priceId = "Price ID is required";
    } else if (!/^[a-z0-9-]+$/.test(priceId)) {
      newErrors.priceId = "Price ID must contain only lowercase letters, numbers, and hyphens";
    } else if (!editingPrice && existingPriceIds.includes(priceId)) {
      newErrors.priceId = "This price ID already exists";
    }

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount < 0) {
      newErrors.amount = "Please enter a valid positive amount";
    }

    // Validate interval
    if (isRecurring) {
      const parsedIntervalCount = parseInt(intervalCount);
      if (!intervalCount || isNaN(parsedIntervalCount) || parsedIntervalCount < 1) {
        newErrors.intervalCount = "Interval count must be a positive number";
      }
    }

    // Validate free trial
    if (hasFreeTrial && isRecurring) {
      const parsedFreeTrialCount = parseInt(freeTrialCount);
      if (!freeTrialCount || isNaN(parsedFreeTrialCount) || parsedFreeTrialCount < 1) {
        newErrors.freeTrialCount = "Free trial duration must be a positive number";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const price: Price = {
      USD: parsedAmount.toFixed(2),
      serverOnly
    };

    if (isRecurring) {
      price.interval = [parseInt(intervalCount), intervalUnit];
      if (hasFreeTrial) {
        price.freeTrial = [parseInt(freeTrialCount), freeTrialUnit];
      }
    }

    onSave(priceId, price);
    handleClose();
  };

  const handleClose = () => {
    if (!editingPrice) {
      setPriceId("");
      setAmount("");
      setIsRecurring(false);
      setIntervalCount("1");
      setIntervalUnit("month");
      setHasFreeTrial(false);
      setFreeTrialCount("7");
      setFreeTrialUnit("day");
      setServerOnly(false);
    }
    setErrors({});
    onOpenChange(false);
  };

  const formatPricePreview = () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) return "";

    let preview = `$${parsedAmount.toFixed(2)}`;

    if (isRecurring) {
      const count = parseInt(intervalCount);
      if (count === 1) {
        preview += ` / ${intervalUnit}`;
      } else {
        preview += ` / ${count} ${intervalUnit}s`;
      }
    } else {
      preview += " (one-time)";
    }

    if (hasFreeTrial && isRecurring) {
      const trialCount = parseInt(freeTrialCount);
      if (trialCount === 1) {
        preview += ` with ${trialCount} ${freeTrialUnit} free trial`;
      } else {
        preview += ` with ${trialCount} ${freeTrialUnit}s free trial`;
      }
    }

    return preview;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editingPrice ? "Edit Price" : "Add Price"}</DialogTitle>
          <DialogDescription>
            Configure the pricing for this offer. You can create one-time or recurring prices with optional free trials.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Price ID */}
          <div className="grid gap-2">
            <Label htmlFor="price-id">
              <SimpleTooltip tooltip="Unique identifier for this price, used in code">
                Price ID
              </SimpleTooltip>
            </Label>
            <Input
              id="price-id"
              value={priceId}
              onChange={(e) => {
                setPriceId(e.target.value);
                if (errors.priceId) {
                  setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.priceId;
                    return newErrors;
                  });
                }
              }}
              placeholder="e.g., monthly-pro"
              disabled={!!editingPrice}
              className={errors.priceId ? "border-destructive" : ""}
            />
            {errors.priceId && (
              <Typography type="label" className="text-destructive">
                {errors.priceId}
              </Typography>
            )}
          </div>

          {/* Amount */}
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) {
                    setErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.amount;
                      return newErrors;
                    });
                  }
                }}
                placeholder="0.00"
                className={cn("pl-8", errors.amount ? "border-destructive" : "")}
              />
            </div>
            {errors.amount && (
              <Typography type="label" className="text-destructive">
                {errors.amount}
              </Typography>
            )}
          </div>

          {/* Recurring */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="recurring"
              checked={isRecurring}
              onCheckedChange={(checked) => setIsRecurring(checked as boolean)}
            />
            <Label htmlFor="recurring" className="cursor-pointer">
              Recurring payment
            </Label>
          </div>

          {/* Billing Interval */}
          {isRecurring && (
            <div className="grid gap-2">
              <Label>
                <SimpleTooltip tooltip="How often the customer will be charged">
                  Billing Interval
                </SimpleTooltip>
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  value={intervalCount}
                  onChange={(e) => {
                    setIntervalCount(e.target.value);
                    if (errors.intervalCount) {
                      setErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors.intervalCount;
                        return newErrors;
                      });
                    }
                  }}
                  className={cn("w-24", errors.intervalCount ? "border-destructive" : "")}
                />
                <Select value={intervalUnit} onValueChange={(value) => setIntervalUnit(value as typeof intervalUnit)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">day(s)</SelectItem>
                    <SelectItem value="week">week(s)</SelectItem>
                    <SelectItem value="month">month(s)</SelectItem>
                    <SelectItem value="year">year(s)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {errors.intervalCount && (
                <Typography type="label" className="text-destructive">
                  {errors.intervalCount}
                </Typography>
              )}
            </div>
          )}

          {/* Free Trial */}
          {isRecurring && (
            <>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="free-trial"
                  checked={hasFreeTrial}
                  onCheckedChange={(checked) => setHasFreeTrial(checked as boolean)}
                />
                <Label htmlFor="free-trial" className="cursor-pointer">
                  Include free trial
                </Label>
              </div>

              {hasFreeTrial && (
                <div className="grid gap-2">
                  <Label>
                    <SimpleTooltip tooltip="How long customers can try before being charged">
                      Free Trial Duration
                    </SimpleTooltip>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={freeTrialCount}
                      onChange={(e) => {
                        setFreeTrialCount(e.target.value);
                        if (errors.freeTrialCount) {
                          setErrors(prev => {
                            const newErrors = { ...prev };
                            delete newErrors.freeTrialCount;
                            return newErrors;
                          });
                        }
                      }}
                      className={cn("w-24", errors.freeTrialCount ? "border-destructive" : "")}
                    />
                    <Select value={freeTrialUnit} onValueChange={(value) => setFreeTrialUnit(value as typeof freeTrialUnit)}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">day(s)</SelectItem>
                        <SelectItem value="week">week(s)</SelectItem>
                        <SelectItem value="month">month(s)</SelectItem>
                        <SelectItem value="year">year(s)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {errors.freeTrialCount && (
                    <Typography type="label" className="text-destructive">
                      {errors.freeTrialCount}
                    </Typography>
                  )}
                </div>
              )}
            </>
          )}

          {/* Server Only */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="server-only"
              checked={serverOnly}
              onCheckedChange={(checked) => setServerOnly(checked as boolean)}
            />
            <Label htmlFor="server-only" className="cursor-pointer">
              <SimpleTooltip tooltip="Hide this price from client-side code for security">
                Server-side only
              </SimpleTooltip>
            </Label>
          </div>

          {/* Price Preview */}
          {amount && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <Typography type="label" className="text-muted-foreground">
                Price preview:
              </Typography>
              <Typography type="p" className="font-medium">
                {formatPricePreview()}
              </Typography>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={validateAndSave}>
            {editingPrice ? "Save Changes" : "Add Price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

