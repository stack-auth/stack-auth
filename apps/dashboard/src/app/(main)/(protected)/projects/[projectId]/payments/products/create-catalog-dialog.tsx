"use client";

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, SimpleTooltip, Typography } from "@/components/ui";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";

type CreateCatalogDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreate: (catalog: { id: string, displayName: string }) => void | Promise<void>,
};

export function CreateCatalogDialog({ open, onOpenChange, onCreate }: CreateCatalogDialogProps) {
  const [catalogId, setCatalogId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<{ id?: string, displayName?: string }>({});

  const validateAndCreate = () => {
    const newErrors: { id?: string, displayName?: string } = {};

    // Validate catalog ID
    if (!catalogId.trim()) {
      newErrors.id = "Catalog ID is required";
    } else if (!isValidUserSpecifiedId(catalogId)) {
      newErrors.id = getUserSpecifiedIdErrorMessage("catalogId");
    }

    // Validate display name
    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    runAsynchronously(onCreate({ id: catalogId.trim(), displayName: displayName.trim() }));

    // Reset form
    setCatalogId("");
    setDisplayName("");
    setErrors({});
    onOpenChange(false);
  };

  const handleClose = () => {
    setCatalogId("");
    setDisplayName("");
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Product Catalog</DialogTitle>
          <DialogDescription>
            Product catalogs allow you to organize related products. Customers can only have one active product from each catalog at a time (except for add-ons).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="catalog-id">
              <SimpleTooltip tooltip="This is the unique identifier for your catalog, used in code">
                Catalog ID
              </SimpleTooltip>
            </Label>
            <Input
              id="catalog-id"
              value={catalogId}
              onChange={(e) => {
                const value = sanitizeUserSpecifiedId(e.target.value);
                setCatalogId(value);
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
              <SimpleTooltip tooltip="This is how the catalog will be displayed to users">
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
            Create Catalog
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

