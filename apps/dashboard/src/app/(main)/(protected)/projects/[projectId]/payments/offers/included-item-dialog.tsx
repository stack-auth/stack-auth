"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

type Interval = [number, 'day' | 'week' | 'month' | 'year'] | 'never';
type ExpiresOption = 'never' | 'when-purchase-expires' | 'when-repeated';

type Offer = CompleteConfig['payments']['offers'][string];
type IncludedItem = Offer['includedItems'][string];
type Price = (Offer['prices'] & object)[string];

type IncludedItemDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (itemId: string, item: IncludedItem) => void,
  editingItemId?: string,
  editingItem?: IncludedItem & { displayName?: string },
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  existingIncludedItemIds?: string[],
  onCreateNewItem?: () => void,
};

const EXPIRES_OPTIONS = [
  {
    value: 'never' as const,
    label: 'Never expires',
    description: 'The item remains with the customer indefinitely'
  },
  {
    value: 'when-purchase-expires' as const,
    label: 'When purchase expires',
    description: 'The item is removed when the subscription ends or expires'
  },
  {
    value: 'when-repeated' as const,
    label: 'When repeated',
    description: 'The item expires when it\'s granted again (only available with repeat)',
    requiresRepeat: true
  }
];

export function IncludedItemDialog({
  open,
  onOpenChange,
  onSave,
  editingItemId,
  editingItem,
  existingItems,
  existingIncludedItemIds = [],
  onCreateNewItem
}: IncludedItemDialogProps) {
  const [selectedItemId, setSelectedItemId] = useState(editingItemId || "");
  const [quantity, setQuantity] = useState(editingItem?.quantity.toString() || "1");
  const [hasRepeat, setHasRepeat] = useState(editingItem?.repeat !== undefined && editingItem.repeat !== 'never');
  const [repeatCount, setRepeatCount] = useState(() => {
    if (editingItem?.repeat && editingItem.repeat !== 'never') {
      return editingItem.repeat[0].toString();
    }
    return "1";
  });
  const [repeatUnit, setRepeatUnit] = useState<'day' | 'week' | 'month' | 'year'>(() => {
    if (editingItem?.repeat && editingItem.repeat !== 'never') {
      return editingItem.repeat[1];
    }
    return "month";
  });
  const [expires, setExpires] = useState<ExpiresOption>(editingItem?.expires || 'never');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateAndSave = () => {
    const newErrors: Record<string, string> = {};

    // Validate item selection
    if (!selectedItemId) {
      newErrors.itemId = "Please select an item";
    } else if (!editingItem && existingIncludedItemIds.includes(selectedItemId)) {
      newErrors.itemId = "This item is already included in the offer";
    }

    // Validate quantity
    const parsedQuantity = parseInt(quantity);
    if (!quantity || isNaN(parsedQuantity) || parsedQuantity < 1) {
      newErrors.quantity = "Quantity must be a positive number";
    }

    // Validate repeat
    if (hasRepeat) {
      const parsedRepeatCount = parseInt(repeatCount);
      if (!repeatCount || isNaN(parsedRepeatCount) || parsedRepeatCount < 1) {
        newErrors.repeatCount = "Repeat interval must be a positive number";
      }
    }

    // Validate expires option
    if (expires === 'when-repeated' && !hasRepeat) {
      newErrors.expires = "Cannot use 'when-repeated' without setting a repeat interval";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const item: IncludedItem = {
      quantity: parsedQuantity,
      repeat: hasRepeat ? [parseInt(repeatCount), repeatUnit] : 'never',
      expires: expires !== 'never' ? expires : 'never'
    };

    onSave(selectedItemId, item);
    handleClose();
  };

  const handleClose = () => {
    if (!editingItem) {
      setSelectedItemId("");
      setQuantity("1");
      setHasRepeat(false);
      setRepeatCount("1");
      setRepeatUnit("month");
      setExpires('never');
    }
    setErrors({});
    onOpenChange(false);
  };

  const selectedItem = existingItems.find(item => item.id === selectedItemId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit Included Item" : "Add Included Item"}</DialogTitle>
          <DialogDescription>
            Configure which items are included with this offer and how they behave.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Item Selection */}
          <div className="grid gap-2">
            <Label htmlFor="item-select">
              <SimpleTooltip tooltip="Choose which item to include with this offer">
                Select Item
              </SimpleTooltip>
            </Label>
            <Select
              value={selectedItemId}
              onValueChange={(value) => {
                if (value === 'create-new') {
                  onCreateNewItem?.();
                } else {
                  setSelectedItemId(value);
                  if (errors.itemId) {
                    setErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.itemId;
                      return newErrors;
                    });
                  }
                }
              }}
              disabled={!!editingItem}
            >
              <SelectTrigger className={cn(errors.itemId ? "border-destructive" : "")}>
                <SelectValue placeholder="Choose an item..." />
              </SelectTrigger>
              <SelectContent>
                {existingItems.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    <div className="flex flex-col">
                      <span>{item.displayName || item.id}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.customerType.toUpperCase()} • {item.id}
                      </span>
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="create-new">
                  <span className="text-primary">+ Create new item</span>
                </SelectItem>
              </SelectContent>
            </Select>
            {errors.itemId && (
              <Typography type="label" className="text-destructive">
                {errors.itemId}
              </Typography>
            )}
          </div>

          {/* Quantity */}
          <div className="grid gap-2">
            <Label htmlFor="quantity">
              <SimpleTooltip tooltip="How many of this item the customer receives">
                Quantity
              </SimpleTooltip>
            </Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                if (errors.quantity) {
                  setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.quantity;
                    return newErrors;
                  });
                }
              }}
              className={errors.quantity ? "border-destructive" : ""}
            />
            {errors.quantity && (
              <Typography type="label" className="text-destructive">
                {errors.quantity}
              </Typography>
            )}
          </div>

          {/* Repeat */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="repeat"
                checked={hasRepeat}
                onCheckedChange={(checked) => {
                  setHasRepeat(checked as boolean);
                  // Reset expires if turning off repeat and it was set to 'when-repeated'
                  if (!checked && expires === 'when-repeated') {
                    setExpires('never');
                    if (errors.expires) {
                      setErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors.expires;
                        return newErrors;
                      });
                    }
                  }
                }}
              />
              <Label htmlFor="repeat" className="cursor-pointer">
                <SimpleTooltip tooltip="The item will be granted again after the specified interval">
                  Grant repeatedly
                </SimpleTooltip>
              </Label>
            </div>

            {hasRepeat && (
              <div className="grid gap-2">
                <Label>
                  <SimpleTooltip tooltip="The item will be granted again after this interval">
                    Repeat Interval
                  </SimpleTooltip>
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={repeatCount}
                    onChange={(e) => {
                      setRepeatCount(e.target.value);
                      if (errors.repeatCount) {
                        setErrors(prev => {
                          const newErrors = { ...prev };
                          delete newErrors.repeatCount;
                          return newErrors;
                        });
                      }
                    }}
                    className={cn("w-24", errors.repeatCount ? "border-destructive" : "")}
                  />
                  <Select value={repeatUnit} onValueChange={(value) => setRepeatUnit(value as typeof repeatUnit)}>
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
                {errors.repeatCount && (
                  <Typography type="label" className="text-destructive">
                    {errors.repeatCount}
                  </Typography>
                )}
              </div>
            )}
          </div>

          {/* Expiration */}
          <div className="grid gap-2">
            <Label>
              <SimpleTooltip tooltip="When the included item should expire">
                Expiration
              </SimpleTooltip>
            </Label>
            <Select
              value={expires}
              onValueChange={(value) => {
                setExpires(value as ExpiresOption);
                if (errors.expires) {
                  setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.expires;
                    return newErrors;
                  });
                }
              }}
            >
              <SelectTrigger className={errors.expires ? "border-destructive" : ""}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRES_OPTIONS.filter(option => !option.requiresRepeat || hasRepeat).map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.expires && (
              <Typography type="label" className="text-destructive">
                {errors.expires}
              </Typography>
            )}
          </div>

          {/* Summary */}
          {selectedItem && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <Typography type="label" className="text-muted-foreground">
                Summary:
              </Typography>
              <Typography type="p" className="text-sm mt-1">
                Grant <span className="font-medium">{quantity}× {selectedItem.displayName || selectedItem.id}</span>
                {hasRepeat && (
                  <span>
                    {' '}every {repeatCount} {repeatUnit}{parseInt(repeatCount) > 1 ? 's' : ''}
                  </span>
                )}
                {expires !== 'never' && (
                  <span>
                    {' '}(expires {EXPIRES_OPTIONS.find(o => o.value === expires)?.label.toLowerCase()})
                  </span>
                )}
              </Typography>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={validateAndSave}>
            {editingItem ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

