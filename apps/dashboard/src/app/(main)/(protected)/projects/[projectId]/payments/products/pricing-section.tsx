"use client";

import { DesignButton } from "@/components/design-components";
import { SimpleTooltip, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GiftIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  createNewEditingPrice,
  editingPriceToPrice,
  PriceEditDialog,
  priceToEditingPrice,
  type EditingPrice,
} from "./price-edit-dialog";
import { formatPriceDisplay, generateUniqueId, getPriceCheckoutError, isFreePrices, type Price } from "./utils";

type PricingSectionProps = {
  prices: Record<string, Price>,
  onPricesChange: (prices: Record<string, Price>) => void,
  hasError?: boolean,
  errorMessage?: string,
  variant?: 'form' | 'dialog',
  // Optional "Make Free" handler. When provided, a button is rendered that
  // replaces the current prices with a single $0 recurring entry. When the
  // current `prices` already match isFreePrices(), the Free card is shown
  // instead of the price list.
  onMakeFree?: () => void,
};

export function PricingSection({
  prices,
  onPricesChange,
  hasError,
  errorMessage,
  variant = 'form',
  onMakeFree,
}: PricingSectionProps) {
  const isFree = isFreePrices(prices);
  const [editingPrice, setEditingPrice] = useState<EditingPrice | null>(null);
  const [isAddingPrice, setIsAddingPrice] = useState(false);

  const handleSavePrice = (editing: EditingPrice, isNew: boolean) => {
    const price = editingPriceToPrice(editing);
    onPricesChange({
      ...prices,
      [editing.priceId]: price,
    });
    setEditingPrice(null);
    setIsAddingPrice(false);
  };

  const handleRemovePrice = (priceId: string) => {
    const newPrices = { ...prices };
    delete newPrices[priceId];
    onPricesChange(newPrices);
  };

  const handleAddClick = () => {
    const newId = generateUniqueId('price');
    setEditingPrice(createNewEditingPrice(newId));
    setIsAddingPrice(true);
  };

  const handleEditClick = (priceId: string) => {
    setEditingPrice(priceToEditingPrice(priceId, prices[priceId]));
    setIsAddingPrice(false);
  };

  if (variant === 'dialog') {
    // Dialog variant - uses ListSection style
    return (
      <>
        {Object.keys(prices).length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Typography type="p">No prices configured yet</Typography>
            <Typography type="p" className="text-sm mt-1">
              Click the + button to add your first price
            </Typography>
            <DesignButton
              variant="outline"
              size="sm"
              type="button"
              className="mt-3"
              onClick={handleAddClick}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </DesignButton>
          </div>
        ) : (
          <div>
            {Object.entries(prices).map(([id, price]) => (
              <div
                key={id}
                className="px-3 py-3 hover:bg-muted/50 flex items-center justify-between transition-colors"
              >
                <div>
                  <div className="font-medium">{formatPriceDisplay(price)}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ID: {id}
                    {price.serverOnly && ' • Server-only'}
                  </div>
                </div>
                <div className="flex gap-1">
                  <DesignButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => handleEditClick(id)}
                  >
                    Edit
                  </DesignButton>
                  <DesignButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={`Remove price ${id}`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRemovePrice(id)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </DesignButton>
                </div>
              </div>
            ))}
            <div className="px-3 py-2 border-t border-border/30">
              <DesignButton
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleAddClick}
                className="w-full justify-start"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add Price
              </DesignButton>
            </div>
          </div>
        )}

        <PriceEditDialog
          open={!!editingPrice}
          onOpenChange={(open) => {
            if (!open) {
              setEditingPrice(null);
              setIsAddingPrice(false);
            }
          }}
          editingPrice={editingPrice}
          onEditingPriceChange={setEditingPrice}
          isAdding={isAddingPrice}
          onSave={handleSavePrice}
        />
      </>
    );
  }

  // Form variant - compact card style
  // Free product state - styled like a price card, but surfaces the underlying
  // $0 price entry so users can see that "Free" is just a regular price row
  // (and isn't doing anything magical under the hood).
  if (isFree) {
    // isFreePrices() guarantees exactly one entry, so destructuring is safe.
    const [freePriceId, freePrice] = Object.entries(prices)[0];
    return (
      <div
        className={cn(
          "flex items-center justify-between p-2.5 rounded-lg",
          "bg-foreground/[0.02] border border-border/30",
          "hover:bg-foreground/[0.04] transition-colors duration-150 hover:transition-none"
        )}
      >
        <div className="flex-1">
          <div className="font-medium text-sm">
            Free <span className="text-foreground/50 font-normal">· {formatPriceDisplay(freePrice)}</span>
          </div>
          <div className="text-xs text-foreground/30 font-mono">{freePriceId}</div>
        </div>
        <div className="flex items-center gap-1">
          <DesignButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Make paid (remove free price)"
            className="text-destructive hover:text-destructive"
            onClick={() => onPricesChange({})}
          >
            <TrashIcon className="h-4 w-4" />
          </DesignButton>
        </div>
      </div>
    );
  }

  return (
    <>
      {Object.keys(prices).length === 0 ? (
        <div className={cn(
          "rounded-lg border border-dashed p-4 text-center",
          hasError ? "border-destructive" : "border-border/50"
        )}>
          <p className="text-sm text-foreground/50 mb-3">
            No prices configured yet
          </p>
          <div className="flex items-center justify-center gap-3">
            <DesignButton
              variant="outline"
              size="sm"
              type="button"
              onClick={handleAddClick}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </DesignButton>
            {onMakeFree && (
              <SimpleTooltip tooltip="Mark this product as free. Customers won't be charged, and no prices can be added.">
                <DesignButton
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={onMakeFree}
                >
                  <GiftIcon className="h-4 w-4 mr-2" />
                  Make Free
                </DesignButton>
              </SimpleTooltip>
            )}
          </div>
          {hasError && errorMessage && (
            <Typography type="label" className="text-destructive text-xs mt-2 block">
              {errorMessage}
            </Typography>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {Object.entries(prices).map(([priceId, price]) => {
            const checkoutError = getPriceCheckoutError(price);
            return (
              <div
                key={priceId}
                className={cn(
                "flex items-center justify-between p-2.5 rounded-lg",
                "bg-foreground/[0.02] border border-border/30",
                "hover:bg-foreground/[0.04] transition-colors duration-150 hover:transition-none",
                checkoutError && "border-destructive/40 bg-destructive/[0.03]"
              )}
              >
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {formatPriceDisplay(price)}
                    {checkoutError && (
                      <SimpleTooltip tooltip={checkoutError}>
                        <WarningIcon className="h-4 w-4 text-destructive" weight="fill" />
                      </SimpleTooltip>
                    )}
                  </div>
                  <div className="text-xs text-foreground/30 font-mono">{priceId}</div>
                </div>
                <div className="flex items-center gap-1">
                  <DesignButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => handleEditClick(priceId)}
                  >
                    Edit
                  </DesignButton>
                  <DesignButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={`Remove price ${priceId}`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRemovePrice(priceId)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </DesignButton>
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <DesignButton
              variant="outline"
              size="sm"
              type="button"
              onClick={handleAddClick}
              className="flex-1"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </DesignButton>
            {onMakeFree && (
              <SimpleTooltip tooltip="Replace all configured prices with a single free tier. Customers won't be charged.">
                <DesignButton
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={onMakeFree}
                >
                  <GiftIcon className="h-4 w-4 mr-2" />
                  Make Free
                </DesignButton>
              </SimpleTooltip>
            )}
          </div>
        </div>
      )}

      <PriceEditDialog
        open={!!editingPrice}
        onOpenChange={(open) => {
          if (!open) {
            setEditingPrice(null);
            setIsAddingPrice(false);
          }
        }}
        editingPrice={editingPrice}
        onEditingPriceChange={setEditingPrice}
        isAdding={isAddingPrice}
        onSave={handleSavePrice}
      />
    </>
  );
}
