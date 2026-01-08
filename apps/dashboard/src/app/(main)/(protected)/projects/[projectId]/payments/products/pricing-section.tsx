"use client";

import { Button, Checkbox, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GiftIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  createNewEditingPrice,
  editingPriceToPrice,
  PriceEditDialog,
  priceToEditingPrice,
  type EditingPrice,
} from "./price-edit-dialog";
import { formatPriceDisplay, generateUniqueId, type Price } from "./utils";

type PricingSectionProps = {
  prices: Record<string, Price>,
  onPricesChange: (prices: Record<string, Price>) => void,
  hasError?: boolean,
  errorMessage?: string,
  variant?: 'form' | 'dialog',
  // Free product handling
  isFree?: boolean,
  freeByDefault?: boolean,
  onMakeFree?: () => void,
  onMakePaid?: () => void,
  onFreeByDefaultChange?: (checked: boolean) => void,
};

export function PricingSection({
  prices,
  onPricesChange,
  hasError,
  errorMessage,
  variant = 'form',
  isFree = false,
  freeByDefault = false,
  onMakeFree,
  onMakePaid,
  onFreeByDefaultChange,
}: PricingSectionProps) {
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
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleAddClick}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </Button>
          </div>
        ) : (
          <div>
            {Object.entries(prices).map(([id, price]) => (
              <div
                key={id}
                className="px-3 py-3 hover:bg-muted/50 flex items-center justify-between catalog transition-colors"
              >
                <div>
                  <div className="font-medium">{formatPriceDisplay(price)}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ID: {id}
                    {price.serverOnly && ' • Server-only'}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditClick(id)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePrice(id)}
                  >
                    <TrashIcon className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="px-3 py-2 border-t border-border/30">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddClick}
                className="w-full justify-start"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add Price
              </Button>
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
  // Free product state - styled like a price card
  if (isFree) {
    return (
      <div
        className={cn(
          "flex items-center justify-between p-2.5 rounded-lg",
          "bg-foreground/[0.02] border border-border/30",
          "hover:bg-foreground/[0.04] transition-colors duration-150 hover:transition-none"
        )}
      >
        <div className="flex-1">
          <div className="font-medium text-sm">Free</div>
          <div>
            {onFreeByDefaultChange && (
              <label className="flex items-center gap-1.5 cursor-pointer mt-1">
                <Checkbox
                  id="free-by-default"
                  checked={freeByDefault}
                  onCheckedChange={(checked) => onFreeByDefaultChange(checked as boolean)}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs text-foreground/50">
                  Include by default for all customers
                </span>
              </label>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMakePaid}
          >
            <TrashIcon className="h-4 w-4 text-destructive" />
          </Button>
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
            <Button
              variant="outline"
              onClick={handleAddClick}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </Button>
            {onMakeFree && (
              <Button
                variant="outline"
                onClick={onMakeFree}
              >
                <GiftIcon className="h-4 w-4 mr-2" />
                Make Free
              </Button>
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
          {Object.entries(prices).map(([priceId, price]) => (
            <div
              key={priceId}
              className={cn(
                "flex items-center justify-between p-2.5 rounded-lg",
                "bg-foreground/[0.02] border border-border/30",
                "hover:bg-foreground/[0.04] transition-colors duration-150 hover:transition-none"
              )}
            >
              <div className="flex-1">
                <div className="font-medium text-sm">{formatPriceDisplay(price)}</div>
                <div className="text-xs text-foreground/30 font-mono">{priceId}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditClick(priceId)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemovePrice(priceId)}
                >
                  <TrashIcon className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleAddClick}
              className="flex-1"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Price
            </Button>
            {onMakeFree && (
              <Button
                variant="outline"
                onClick={onMakeFree}
              >
                <GiftIcon className="h-4 w-4 mr-2" />
                Make Free
              </Button>
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
