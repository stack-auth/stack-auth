"use client";

import {
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Checkbox, Label, SimpleTooltip, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PackageIcon } from "@phosphor-icons/react";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useMemo, useState } from "react";

type ExpiresOption = 'never' | 'when-purchase-expires' | 'when-repeated';

type Product = CompleteConfig['payments']['products'][string];
type IncludedItem = Product['includedItems'][string];

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
      newErrors.itemId = "This item is already included in the product";
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

  const itemSelectOptions = useMemo(() => [
    ...existingItems.map(item => ({
      value: item.id,
      label: `${item.displayName || item.id} (${item.customerType.toUpperCase()} · ${item.id})`,
    })),
    { value: 'create-new', label: '+ Create new item' },
  ], [existingItems]);

  const repeatUnitOptions = useMemo(() => [
    { value: 'day', label: 'day(s)' },
    { value: 'week', label: 'week(s)' },
    { value: 'month', label: 'month(s)' },
    { value: 'year', label: 'year(s)' },
  ], []);

  const expiresSelectOptions = useMemo(() => EXPIRES_OPTIONS
    .filter(option => !option.requiresRepeat || hasRepeat)
    .map(option => ({ value: option.value, label: option.label })), [hasRepeat]);

  const expiresDescription = EXPIRES_OPTIONS.find(o => o.value === expires)?.description;

  return (
    <DesignDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
      size="lg"
      icon={PackageIcon}
      title={editingItem ? "Edit Included Item" : "Add Included Item"}
      description="Configure which items are included with this product and how they behave."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" type="button" onClick={validateAndSave}>
            {editingItem ? "Save Changes" : "Add Item"}
          </DesignButton>
        </>
      )}
    >
      <div className="grid gap-4">
        {/* Item Selection */}
        <div className="grid gap-2">
          <Label htmlFor="item-select">
            <SimpleTooltip tooltip="Choose which item to include with this product">
              Select Item
            </SimpleTooltip>
          </Label>
          <DesignSelectorDropdown
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
            options={itemSelectOptions}
            disabled={!!editingItem}
            placeholder="Choose an item..."
            size="md"
            triggerClassName={cn(errors.itemId && "border-destructive")}
          />
          {errors.itemId && (
            <Typography type="label" className="text-destructive text-xs">
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
          <DesignInput
            id="quantity"
            type="number"
            min={1}
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
            size="md"
            className={errors.quantity ? "border-destructive focus-visible:ring-destructive/30" : ""}
          />
          {errors.quantity && (
            <Typography type="label" className="text-destructive text-xs">
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
                <DesignInput
                  type="number"
                  min={1}
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
                  size="md"
                  className={cn("w-24 shrink-0", errors.repeatCount ? "border-destructive focus-visible:ring-destructive/30" : "")}
                />
                <DesignSelectorDropdown
                  value={repeatUnit}
                  onValueChange={(value) => setRepeatUnit(value as typeof repeatUnit)}
                  options={repeatUnitOptions}
                  size="md"
                  className="min-w-0 flex-1"
                />
              </div>
              {errors.repeatCount && (
                <Typography type="label" className="text-destructive text-xs">
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
          <DesignSelectorDropdown
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
            options={expiresSelectOptions}
            size="md"
            triggerClassName={cn(errors.expires && "border-destructive")}
          />
          {expiresDescription ? (
            <Typography type="label" className="text-muted-foreground text-xs">
              {expiresDescription}
            </Typography>
          ) : null}
          {errors.expires && (
            <Typography type="label" className="text-destructive text-xs">
              {errors.expires}
            </Typography>
          )}
        </div>

        {/* Summary */}
        {selectedItem && (
          <div className="rounded-xl border border-border/50 bg-foreground/[0.02] p-3 ring-1 ring-foreground/[0.06]">
            <Typography type="label" className="text-muted-foreground text-xs">
              Summary
            </Typography>
            <Typography type="p" className="text-sm mt-2 text-foreground">
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
    </DesignDialog>
  );
}

