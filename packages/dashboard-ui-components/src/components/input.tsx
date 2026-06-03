"use client";

import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "@hexclave/ui";

export type DesignInputProps = {
  prefixItem?: React.ReactNode,
  leadingIcon?: React.ReactNode,
  size?: "sm" | "md" | "lg",
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">;

export const DesignInput = forwardRefIfNeeded<HTMLInputElement, DesignInputProps>(
  ({ className, type, prefixItem, leadingIcon, size = "md", ...props }, ref) => {
    const heightTextClasses = size === "sm"
      ? "h-7 text-xs"
      : size === "lg"
        ? "h-10 text-sm"
        : "h-9 text-sm";
    const horizontalPaddingClasses = size === "sm" ? "px-2" : size === "lg" ? "px-4" : "px-3";
    const baseClasses = cn(
      "stack-scope flex w-full rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      "placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-all duration-150 hover:transition-none hover:bg-white dark:hover:bg-foreground/[0.06]",
      heightTextClasses
    );

    const leadingIconClasses = size === "sm"
      ? "left-2.5 [&_svg]:size-3"
      : size === "lg"
        ? "left-3.5 [&_svg]:size-4"
        : "left-3 [&_svg]:size-3.5";
    const leadingIconPadding = size === "sm" ? "pl-8" : size === "lg" ? "pl-10" : "pl-9";

    if (prefixItem) {
      return (
        <div className="flex w-full flex-row items-center overflow-hidden rounded-xl border border-black/[0.08] bg-white/80 shadow-sm ring-1 ring-black/[0.08] transition-all duration-150 hover:bg-white hover:transition-none dark:border-white/[0.06] dark:bg-foreground/[0.03] dark:ring-white/[0.06] focus-within:ring-1 focus-within:ring-foreground/[0.1] dark:hover:bg-foreground/[0.06]">
          <div className={cn(
            "flex self-stretch items-center justify-center select-none text-muted-foreground/70 border-r border-black/[0.06] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02]",
            size === "sm" ? "px-2.5 text-xs" : size === "lg" ? "px-3.5 text-sm" : "px-3 text-sm"
          )}>
            {prefixItem}
          </div>
          <input
            type={type}
            className={cn(
              "stack-scope flex w-full bg-transparent",
              "file:border-0 file:bg-transparent file:text-sm file:font-medium",
              "placeholder:text-muted-foreground/50 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              heightTextClasses,
              horizontalPaddingClasses,
              "rounded-none border-0 shadow-none ring-0 focus-visible:ring-0",
              className
            )}
            ref={ref}
            {...props}
          />
        </div>
      );
    }

    if (leadingIcon) {
      return (
        <div className={cn("relative w-full", className)}>
          <div className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:block",
            leadingIconClasses,
          )}>
            {leadingIcon}
          </div>
          <input
            type={type}
            className={cn(baseClasses, leadingIconPadding)}
            ref={ref}
            {...props}
          />
        </div>
      );
    }

    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(baseClasses, horizontalPaddingClasses, className)}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);
DesignInput.displayName = "DesignInput";
