"use client";

import { cn } from "@/lib/utils";
import { getPriceLabel, shortenedInterval } from "./purchase-utils";

type PriceData = {
  USD?: string,
  interval?: [number, string],
};

type Props = {
  priceId: string,
  priceData: PriceData,
  selected: boolean,
  onSelect: (priceId: string) => void,
};

export function PurchasePriceOption({ priceId, priceData, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(priceId)}
      aria-pressed={selected}
      className={cn(
        "group relative w-full rounded-2xl border py-5 px-6 text-left transition-all duration-150 hover:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-blue-500 bg-blue-500/[0.03] ring-1 ring-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.06)]"
          : "border-border/30 bg-foreground/[0.015] hover:border-blue-500/30 hover:bg-foreground/[0.03] hover:shadow-[0_0_15px_rgba(255,255,255,0.01)]",
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          {/* Custom Radio Indicator */}
          {selected ? (
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]">
              <div className="size-2 rounded-full bg-white" />
            </div>
          ) : (
            <div className="size-5 shrink-0 rounded-full border border-border/60 dark:border-white/20 group-hover:border-blue-500/50 transition-colors duration-150" />
          )}
          <span className="text-base font-semibold text-foreground truncate">
            {getPriceLabel(priceData.interval)}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-base font-bold text-foreground">${priceData.USD ?? "0.00"}</span>
          {priceData.interval && (
            <span className="text-xs text-muted-foreground/80 ml-1">
              /{shortenedInterval(priceData.interval)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
