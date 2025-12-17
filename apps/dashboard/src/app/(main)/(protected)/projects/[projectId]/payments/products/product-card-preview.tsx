"use client";

import { cn } from "@/lib/utils";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Gift, Layers, Puzzle, Server } from "lucide-react";
import { Fragment } from "react";
import {
  freeTrialLabel,
  getPricesObject,
  intervalLabel,
  shortIntervalLabel,
  type PricesObject,
  type Product,
} from "./utils";

// Customer type badge colors
const CUSTOMER_TYPE_COLORS = {
  user: 'bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 ring-blue-500/30',
  team: 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-emerald-500/30',
  custom: 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-amber-500/30',
} as const;

type ProductCardPreviewProps = {
  productId: string,
  product: Product,
  existingItems?: Array<{ id: string, displayName: string, customerType: string }>,
  className?: string,
};

function PriceDisplay({ price }: { price: PricesObject[string] }) {
  const amount = price.USD ? parseFloat(price.USD) : 0;
  const formattedAmount = amount === 0 ? 'Free' : `$${amount.toFixed(2)}`;
  const intervalText = intervalLabel(price.interval);
  const freeTrialText = freeTrialLabel(price.freeTrial);

  return (
    <div className="text-center">
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-2xl font-bold tracking-tight">
          {formattedAmount}
        </span>
        {intervalText && (
          <span className="text-sm text-muted-foreground">
            / {intervalText.toLowerCase().replace('every ', '')}
          </span>
        )}
      </div>
      {freeTrialText && (
        <div className="mt-1 text-xs text-muted-foreground">
          <Gift className="inline h-3 w-3 mr-1" />
          {freeTrialText} free trial
        </div>
      )}
    </div>
  );
}

export function ProductCardPreview({
  productId,
  product,
  existingItems = [],
  className,
}: ProductCardPreviewProps) {
  const customerType = product.customerType;
  const pricesObject = getPricesObject(product);
  const priceEntries = typedEntries(pricesObject);
  const itemsList = typedEntries(product.includedItems);

  const toggleBadges = [
    { key: 'serverOnly', label: 'Server only', active: !!product.serverOnly, icon: <Server className="h-3 w-3" /> },
    { key: 'stackable', label: 'Stackable', active: !!product.stackable, icon: <Layers className="h-3 w-3" /> },
  ].filter(b => b.active);

  return (
    <div
      className={cn(
        "relative flex flex-col h-full",
        "rounded-2xl overflow-hidden",
        "bg-gray-200/80 dark:bg-[hsl(240,10%,5.5%)]",
        "border border-border/50 dark:border-foreground/[0.12]",
        "shadow-sm",
        className
      )}
    >
      {/* Main content wrapper */}
      <div className="flex-1 flex flex-col">
        {/* Header section */}
        <div className="relative px-5 pt-5 pb-3">
          {/* Customer type badge and Product ID */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
              CUSTOMER_TYPE_COLORS[customerType]
            )}>
              {customerType}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-mono text-muted-foreground bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
              ID: {productId || 'product-id'}
            </span>
          </div>
          {/* Product name */}
          <h3 className="text-lg font-semibold text-center tracking-tight flex items-center justify-center gap-1.5">
            {product.isAddOnTo !== false && <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />}
            {product.displayName || "Untitled Product"}
          </h3>
        </div>

        {/* Toggle badges */}
        {toggleBadges.length > 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 pb-3">
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {toggleBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
                    "bg-foreground/[0.06] text-muted-foreground ring-1 ring-foreground/[0.06]"
                  )}
                >
                  {badge.icon}
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Pricing section */}
        <div className={cn(
          "border-t border-border/20 dark:border-foreground/[0.06] px-5 py-4",
          itemsList.length === 0 && "flex-1"
        )}>
          {priceEntries.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">
              No prices configured
            </div>
          ) : (
            <div className="space-y-3">
              {priceEntries.map(([priceId, price], index) => (
                <Fragment key={priceId}>
                  <PriceDisplay price={price} />
                  {index < priceEntries.length - 1 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Items section */}
        {itemsList.length > 0 && (
          <div className="flex-1 border-t border-border/20 dark:border-foreground/[0.06] px-5 py-3">
            <div className="space-y-1">
              {itemsList.map(([itemId, item]) => {
                const itemMeta = existingItems.find(i => i.id === itemId);
                const itemLabel = itemMeta ? itemMeta.displayName : itemId;
                return (
                  <div key={itemId} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{itemLabel}</span>
                    <span className="text-foreground tabular-nums">
                      {prettyPrintWithMagnitudes(item.quantity)}
                      <span className="text-muted-foreground text-xs ml-1">{shortIntervalLabel(item.repeat)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

