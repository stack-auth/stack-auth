"use client";

import { cn } from "@/lib/utils";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Typography } from "@/components/ui";
import { Package } from "lucide-react";
import { useEffect, useState } from "react";

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

  const validateAndSave = async () => {
    const newErrors: Record<string, string> = {};

    // Validate item ID
    if (!itemId.trim()) {
      newErrors.itemId = "Item ID is required";
    } else if (!/^[a-z0-9_-]+$/.test(itemId)) {
      newErrors.itemId = "Item ID must contain only lowercase letters, numbers, underscores, and hyphens";
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn(
        "sm:max-w-[480px] rounded-2xl",
        "bg-background/95 backdrop-blur-xl",
        "border border-border/50 dark:border-foreground/[0.1]",
        "shadow-2xl"
      )}>
        <DialogHeader className="pb-4 border-b border-border/30 dark:border-foreground/[0.06]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 dark:bg-cyan-500/[0.15]">
              <Package className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                {editingItem ? "Edit Item" : "Create Item"}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                Items are features or services that customers receive.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-5 py-5">
          {/* Item ID */}
          <div className="grid gap-2">
            <Label htmlFor="item-id" className="text-sm font-medium">
              Item ID
            </Label>
            <Input
              id="item-id"
              value={itemId}
              onChange={(e) => {
                const nextValue = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
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
              className={cn(
                "h-10 rounded-xl font-mono text-sm",
                "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50",
                "transition-all duration-150 hover:transition-none",
                errors.itemId && "border-destructive focus:ring-destructive/30"
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

          {/* Display Name */}
          <div className="grid gap-2">
            <Label htmlFor="display-name" className="text-sm font-medium">
              Display Name
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
              className={cn(
                "h-10 rounded-xl text-sm",
                "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50",
                "transition-all duration-150 hover:transition-none",
                errors.displayName && "border-destructive focus:ring-destructive/30"
              )}
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

          {/* Customer Type */}
          <div className="grid gap-2">
            <Label htmlFor="customer-type" className="text-sm font-medium">
              Customer Type
            </Label>
            <Select
              value={customerType}
              disabled={!!forceCustomerType}
              onValueChange={(value) => setCustomerType(value as typeof customerType)}
            >
              <SelectTrigger className={cn(
                "h-10 rounded-xl text-sm",
                "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50"
              )}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="user" className="rounded-lg">User</SelectItem>
                <SelectItem value="team" className="rounded-lg">Team</SelectItem>
                <SelectItem value="custom" className="rounded-lg">Custom</SelectItem>
              </SelectContent>
            </Select>
            <Typography type="label" className="text-muted-foreground text-xs">
              Which type of customer can hold this item
            </Typography>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t border-border/30 dark:border-foreground/[0.06] gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className={cn(
              "rounded-xl px-5",
              "border-border/50 dark:border-foreground/[0.1]",
              "hover:bg-foreground/[0.03]",
              "transition-all duration-150 hover:transition-none"
            )}
          >
            Cancel
          </Button>
          <Button
            onClick={validateAndSave}
            className={cn(
              "rounded-xl px-5",
              "bg-foreground text-background",
              "hover:bg-foreground/90",
              "transition-all duration-150 hover:transition-none"
            )}
          >
            {editingItem ? "Save Changes" : "Create Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
