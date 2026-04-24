"use client";

import {
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Label, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PackageIcon } from "@phosphor-icons/react";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@stackframe/stack-shared/dist/schema-fields";
import { useEffect, useMemo, useState } from "react";

type ItemDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (item: { id: string, displayName: string, customerType: 'user' | 'team' | 'custom' }) => Promise<void>,
  editingItem?: {
    id: string,
    displayName: string,
    customerType: 'user' | 'team' | 'custom',
  },
  existingItemIds?: string[],
  forceCustomerType?: 'user' | 'team' | 'custom',
};

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'custom', label: 'Custom' },
] as const;

export function ItemDialog({
  open,
  onOpenChange,
  onSave,
  editingItem,
  existingItemIds = [],
  forceCustomerType
}: ItemDialogProps) {
  const [itemId, setItemId] = useState(editingItem?.id || "");
  const [displayName, setDisplayName] = useState(editingItem?.displayName || "");
  const [customerType, setCustomerType] = useState<'user' | 'team' | 'custom'>(forceCustomerType || editingItem?.customerType || 'user');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const customerTypeDropdownOptions = useMemo(
    () => CUSTOMER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    []
  );

  const validateAndSave = async () => {
    const newErrors: Record<string, string> = {};

    if (!itemId.trim()) {
      newErrors.itemId = "Item ID is required";
    } else if (!isValidUserSpecifiedId(itemId)) {
      newErrors.itemId = getUserSpecifiedIdErrorMessage("itemId");
    } else if (!editingItem && existingItemIds.includes(itemId)) {
      newErrors.itemId = "This item ID already exists";
    }

    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    await onSave({
      id: itemId.trim(),
      displayName: displayName.trim(),
      customerType
    });

    handleClose();
  };

  useEffect(() => {
    if (forceCustomerType || editingItem?.customerType) {
      setCustomerType(forceCustomerType || editingItem?.customerType || 'user');
    }
  }, [forceCustomerType, editingItem]);

  const handleClose = () => {
    if (!editingItem) {
      setItemId("");
      setDisplayName("");
      setCustomerType('user');
    }
    setErrors({});
    onOpenChange(false);
  };

  return (
    <DesignDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
      size="md"
      icon={PackageIcon}
      title={editingItem ? "Edit Item" : "Create Item"}
      description="Items are features or services that customers receive."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" type="button" onClick={validateAndSave}>
            {editingItem ? "Save Changes" : "Create Item"}
          </DesignButton>
        </>
      )}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="item-id" className="text-sm font-medium">
            Item ID
          </Label>
          <DesignInput
            id="item-id"
            value={itemId}
            onChange={(e) => {
              const nextValue = sanitizeUserSpecifiedId(e.target.value);
              setItemId(nextValue);
              if (errors.itemId) {
                setErrors(prev => {
                  const newErrors = { ...prev };
                  delete newErrors.itemId;
                  return newErrors;
                });
              }
            }}
            placeholder="e.g., api-calls"
            disabled={!!editingItem}
            size="md"
            className={cn(
              "font-mono text-sm",
              errors.itemId && "border-destructive focus-visible:ring-destructive/30"
            )}
          />
          {errors.itemId ? (
            <Typography type="label" className="text-destructive text-xs">
              {errors.itemId}
            </Typography>
          ) : (
            <Typography type="label" className="text-muted-foreground text-xs">
              Unique identifier used in your code
            </Typography>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="display-name" className="text-sm font-medium">
            Display Name
          </Label>
          <DesignInput
            id="display-name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (errors.displayName) {
                setErrors(prev => {
                  const newErrors = { ...prev };
                  delete newErrors.displayName;
                  return newErrors;
                });
              }
            }}
            placeholder="e.g., API Calls"
            size="md"
            className={cn(errors.displayName && "border-destructive focus-visible:ring-destructive/30")}
          />
          {errors.displayName ? (
            <Typography type="label" className="text-destructive text-xs">
              {errors.displayName}
            </Typography>
          ) : (
            <Typography type="label" className="text-muted-foreground text-xs">
              How this item appears to customers
            </Typography>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="customer-type" className="text-sm font-medium">
            Customer Type
          </Label>
          <DesignSelectorDropdown
            value={customerType}
            onValueChange={(value) => setCustomerType(value as typeof customerType)}
            options={customerTypeDropdownOptions}
            disabled={!!forceCustomerType}
            size="md"
          />
          <Typography type="label" className="text-muted-foreground text-xs">
            Which type of customer can hold this item
          </Typography>
        </div>
      </div>
    </DesignDialog>
  );
}
