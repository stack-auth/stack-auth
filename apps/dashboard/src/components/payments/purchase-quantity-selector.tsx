"use client";

import { DesignInput } from "@/components/design-components/input";
import { DesignButton } from "@/components/design-components/button";
import { Typography } from "@/components/ui";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { shortenedInterval } from "./purchase-utils";

type PriceData = {
  USD?: string,
  interval?: [number, string],
};

type Props = {
  quantityInput: string,
  quantityNumber: number,
  onQuantityChange: (value: string) => void,
  isTooLarge: boolean,
  selectedPriceId: string,
  priceData: PriceData,
};

export function PurchaseQuantitySelector({
  quantityInput,
  quantityNumber,
  onQuantityChange,
  isTooLarge,
  selectedPriceId,
  priceData,
}: Props) {
  const unitPriceUsd = Number(priceData.USD ?? "0");
  const totalAmount = selectedPriceId && Number.isFinite(unitPriceUsd)
    ? (unitPriceUsd * Math.max(0, quantityNumber)).toFixed(2)
    : "0.00";

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Typography type="label" className="text-sm font-semibold text-foreground">
            Quantity
          </Typography>
          <div className="flex items-center gap-2">
            <DesignButton
              type="button"
              size="icon"
              variant="outline"
              className="size-8 border-border/40 bg-foreground/[0.01] hover:bg-foreground/[0.03]"
              disabled={quantityNumber <= 1}
              aria-label="Decrease quantity"
              onClick={() => onQuantityChange(String(Math.max(1, quantityNumber - 1)))}
            >
              <MinusIcon className="size-3.5 text-foreground" />
            </DesignButton>
            <DesignInput
              className="h-8 w-20 text-center text-sm font-semibold tabular-nums border-border/40 bg-foreground/[0.01] text-foreground focus-visible:ring-blue-500/20"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={quantityInput}
              aria-label="Quantity"
              onChange={(event) => {
                const digitsOnly = event.target.value.replace(/[^0-9]/g, "");
                onQuantityChange(digitsOnly);
              }}
            />
            <DesignButton
              type="button"
              size="icon"
              variant="outline"
              className="size-8 border-border/40 bg-foreground/[0.01] hover:bg-foreground/[0.03]"
              aria-label="Increase quantity"
              onClick={() => onQuantityChange(String(quantityNumber + 1))}
            >
              <PlusIcon className="size-3.5 text-foreground" />
            </DesignButton>
          </div>
        </div>
        {(quantityNumber < 1 || isTooLarge) && (
          <Typography type="footnote" variant="destructive" className="text-xs">
            {quantityNumber < 1
              ? "Please enter a quantity of at least 1."
              : "Amount exceeds the maximum limit of $999,999. Please reduce the quantity."}
          </Typography>
        )}
      </div>

      <div className="border-t border-border/40 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <Typography type="label" className="text-sm font-semibold text-foreground">
            Total Amount
          </Typography>
          <div className="text-right">
            <Typography type="h2" className="text-xl font-bold tabular-nums text-foreground">
              ${totalAmount}
            </Typography>
            {selectedPriceId && priceData.interval && (
              <Typography type="p" variant="secondary" className="text-xs text-muted-foreground mt-0.5">
                per {shortenedInterval(priceData.interval)}
              </Typography>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
