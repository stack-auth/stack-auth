"use client";

import { cn } from "@/lib/utils";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

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
};

export function ItemDialog({
  open,
  onOpenChange,
  onSave,
  editingItem,
  existingItemIds = []
}: ItemDialogProps) {
  const [itemId, setItemId] = useState(editingItem?.id || "");
  const [displayName, setDisplayName] = useState(editingItem?.displayName || "");
  const [customerType, setCustomerType] = useState<'user' | 'team' | 'custom'>(editingItem?.customerType || 'user');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateAndSave = async () => {
    const newErrors: Record<string, string> = {};

    // Validate item ID
    if (!itemId.trim()) {
      newErrors.itemId = "Item ID is required";
    } else if (!/^[a-z0-9-]+$/.test(itemId)) {
      newErrors.itemId = "Item ID must contain only lowercase letters, numbers, and hyphens";
    } else if (!editingItem && existingItemIds.includes(itemId)) {
      newErrors.itemId = "This item ID already exists";
    }

    // Validate display name
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit Item" : "Create Item"}</DialogTitle>
          <DialogDescription>
            Items are features or services that customers receive. They appear as rows in your pricing table.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Item ID */}
          <div className="grid gap-2">
            <Label htmlFor="item-id">
              <SimpleTooltip tooltip="Unique identifier for this item, used in code">
                Item ID
              </SimpleTooltip>
            </Label>
            <Input
              id="item-id"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
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
              className={cn(errors.itemId ? "border-destructive" : "")}
            />
            {errors.itemId && (
              <Typography type="label" className="text-destructive">
                {errors.itemId}
              </Typography>
            )}
          </div>

          {/* Display Name */}
          <div className="grid gap-2">
            <Label htmlFor="display-name">
              <SimpleTooltip tooltip="How this item will be displayed to users">
                Display Name
              </SimpleTooltip>
            </Label>
            <Input
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
              className={cn(errors.displayName ? "border-destructive" : "")}
            />
            {errors.displayName && (
              <Typography type="label" className="text-destructive">
                {errors.displayName}
              </Typography>
            )}
          </div>

          {/* Customer Type */}
          <div className="grid gap-2">
            <Label htmlFor="customer-type">
              <SimpleTooltip tooltip="Which type of customer can hold this item">
                Customer Type
              </SimpleTooltip>
            </Label>
            <Select
              value={customerType}
              onValueChange={(value) => setCustomerType(value as typeof customerType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={validateAndSave}>
            {editingItem ? "Save Changes" : "Create Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
