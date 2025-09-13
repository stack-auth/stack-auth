"use client";

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

type CreateGroupDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreate: (group: { id: string, displayName: string }) => void,
};

export function CreateGroupDialog({ open, onOpenChange, onCreate }: CreateGroupDialogProps) {
  const [groupId, setGroupId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<{ id?: string, displayName?: string }>({});

  const validateAndCreate = () => {
    const newErrors: { id?: string, displayName?: string } = {};

    // Validate group ID
    if (!groupId.trim()) {
      newErrors.id = "Group ID is required";
    } else if (!/^[a-z0-9-]+$/.test(groupId)) {
      newErrors.id = "Group ID must contain only lowercase letters, numbers, and hyphens";
    }

    // Validate display name
    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onCreate({ id: groupId.trim(), displayName: displayName.trim() });

    // Reset form
    setGroupId("");
    setDisplayName("");
    setErrors({});
    onOpenChange(false);
  };

  const handleClose = () => {
    setGroupId("");
    setDisplayName("");
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Offer Group</DialogTitle>
          <DialogDescription>
            Offer groups allow you to organize related offers. Customers can only have one active offer from each group at a time (except for add-ons).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="group-id">
              <SimpleTooltip tooltip="This is the unique identifier for your group, used in code">
                Group ID
              </SimpleTooltip>
            </Label>
            <Input
              id="group-id"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setErrors(prev => ({ ...prev, id: undefined }));
              }}
              placeholder="e.g., pricing-tiers"
              className={errors.id ? "border-destructive" : ""}
            />
            {errors.id && (
              <Typography type="label" className="text-destructive">
                {errors.id}
              </Typography>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="display-name">
              <SimpleTooltip tooltip="This is how the group will be displayed to users">
                Display Name
              </SimpleTooltip>
            </Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setErrors(prev => ({ ...prev, displayName: undefined }));
              }}
              placeholder="e.g., Pricing Tiers"
              className={errors.displayName ? "border-destructive" : ""}
            />
            {errors.displayName && (
              <Typography type="label" className="text-destructive">
                {errors.displayName}
              </Typography>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={validateAndCreate}>
            Create Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

