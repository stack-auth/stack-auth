"use client";

import {
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignInput,
} from "@/components/design-components";
import { Label, SimpleTooltip, Typography } from "@/components/ui";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";

// Helper to convert display name to ID format
function toIdFormat(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type CreateProductLineDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreate: (productLine: { id: string, displayName: string }) => void | Promise<void>,
};

export function CreateProductLineDialog({ open, onOpenChange, onCreate }: CreateProductLineDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [productLineId, setProductLineId] = useState("");
  const [hasManuallyEditedId, setHasManuallyEditedId] = useState(false);
  const [errors, setErrors] = useState<{ id?: string, displayName?: string }>({});

  const validateAndCreate = () => {
    const newErrors: { id?: string, displayName?: string } = {};

    // Validate display name
    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    // Validate product line ID
    if (!productLineId.trim()) {
      newErrors.id = "Product Line ID is required";
    } else if (!isValidUserSpecifiedId(productLineId)) {
      newErrors.id = getUserSpecifiedIdErrorMessage("productLineId");
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    runAsynchronously(onCreate({ id: productLineId.trim(), displayName: displayName.trim() }));

    // Reset form
    setDisplayName("");
    setProductLineId("");
    setHasManuallyEditedId(false);
    setErrors({});
    onOpenChange(false);
  };

  const handleClose = () => {
    setDisplayName("");
    setProductLineId("");
    setHasManuallyEditedId(false);
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
      icon={FolderOpenIcon}
      title="Create Product Line"
      description="Product lines allow you to organize related products. Customers can only have one active product from each product line at a time (except for add-ons)."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" type="button" onClick={validateAndCreate}>
            Create Product Line
          </DesignButton>
        </>
      )}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="display-name">
            <SimpleTooltip tooltip="This is how the product line will be displayed to users">
              Display Name
            </SimpleTooltip>
          </Label>
          <DesignInput
            id="display-name"
            value={displayName}
            onChange={(e) => {
              const value = e.target.value;
              setDisplayName(value);
              setErrors(prev => ({ ...prev, displayName: undefined }));
              if (!hasManuallyEditedId) {
                setProductLineId(toIdFormat(value));
                setErrors(prev => ({ ...prev, id: undefined }));
              }
            }}
            placeholder="e.g., Pricing Tiers"
            size="md"
            className={errors.displayName ? "border-destructive focus-visible:ring-destructive/30" : ""}
          />
          {errors.displayName && (
            <Typography type="label" className="text-destructive text-xs">
              {errors.displayName}
            </Typography>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-line-id">
            <SimpleTooltip tooltip="This is the unique identifier for your product line, used in code">
              Product Line ID
            </SimpleTooltip>
          </Label>
          <DesignInput
            id="product-line-id"
            value={productLineId}
            onChange={(e) => {
              const value = sanitizeUserSpecifiedId(e.target.value);
              setProductLineId(value);
              setHasManuallyEditedId(true);
              setErrors(prev => ({ ...prev, id: undefined }));
            }}
            placeholder="e.g., pricing-tiers"
            size="md"
            className={`font-mono text-sm ${errors.id ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
          />
          {errors.id && (
            <Typography type="label" className="text-destructive text-xs">
              {errors.id}
            </Typography>
          )}
        </div>
      </div>
    </DesignDialog>
  );
}
