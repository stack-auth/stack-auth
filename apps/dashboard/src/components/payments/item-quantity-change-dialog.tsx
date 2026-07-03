"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import {
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignInput,
} from "@/components/design-components";
import { Label, Typography, toast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PlusMinusIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { useEffect, useState } from "react";
import type { CustomerType } from "./customer-selector";

type Props = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  customerType: CustomerType,
  customerId: string,
  itemId: string,
  itemDisplayName: string,
  currentQuantity: number,
};

function parseQuantityChange(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed === 0) return null;
  return parsed;
}

/**
 * Dialog for creating a manual item quantity change (positive or negative
 * delta) for a single customer and a single item. Opened from the item
 * balances card on the customer payments views.
 */
export function ItemQuantityChangeDialog(props: Props) {
  const hexclaveAdminApp = useAdminApp();
  const [quantityText, setQuantityText] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the form whenever the dialog is (re)opened so stale input doesn't
  // leak across invocations.
  useEffect(() => {
    if (props.open) {
      setQuantityText("");
      setDescription("");
      setError(null);
    }
  }, [props.open]);

  const parsedQuantity = parseQuantityChange(quantityText);
  const newQuantity = parsedQuantity == null ? null : props.currentQuantity + parsedQuantity;

  const submit = async () => {
    if (parsedQuantity == null) {
      setError("Enter a non-zero whole number. Use a negative value to subtract.");
      return;
    }
    setIsSubmitting(true);
    try {
      const customerOptions = props.customerType === "user"
        ? { userId: props.customerId }
        : props.customerType === "team"
          ? { teamId: props.customerId }
          : { customCustomerId: props.customerId };
      const result = await Result.fromPromise(hexclaveAdminApp.createItemQuantityChange({
        ...customerOptions,
        itemId: props.itemId,
        quantity: parsedQuantity,
        ...(description.trim() ? { description: description.trim() } : {}),
      }));
      if (result.status === "error") {
        toast({ title: "Failed to update item quantity", variant: "destructive" });
        return;
      }
      toast({ title: `${props.itemDisplayName}: quantity changed by ${parsedQuantity > 0 ? "+" : ""}${parsedQuantity}` });
      props.onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DesignDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      icon={PlusMinusIcon}
      title="Adjust Item Quantity"
      description={`Create a manual quantity change for ${props.itemDisplayName}.`}
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button" disabled={isSubmitting}>
              Cancel
            </DesignButton>
          </DesignDialogClose>
          <DesignButton
            size="sm"
            type="button"
            disabled={isSubmitting || parsedQuantity == null}
            loading={isSubmitting}
            onClick={() => runAsynchronouslyWithAlert(submit())}
          >
            Apply Change
          </DesignButton>
        </>
      )}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="quantity-change" className="text-sm font-medium">
            Quantity change
          </Label>
          <DesignInput
            id="quantity-change"
            value={quantityText}
            onChange={(e) => {
              setQuantityText(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. 10 or -5"
            inputMode="numeric"
            autoFocus
            size="md"
            className={cn(
              "tabular-nums",
              error && "border-destructive focus-visible:ring-destructive/30",
            )}
          />
          {error ? (
            <Typography type="label" className="text-destructive text-xs">
              {error}
            </Typography>
          ) : (
            <Typography type="label" className="text-muted-foreground text-xs">
              {newQuantity == null
                ? "Positive values add to the balance, negative values subtract."
                : `New balance: ${props.currentQuantity} → ${newQuantity}`}
            </Typography>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="quantity-change-description" className="text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <DesignInput
            id="quantity-change-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Support credit for outage"
            size="md"
          />
        </div>
      </div>
    </DesignDialog>
  );
}
