import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "./utils";

export type InputProps = {
  prefixItem?: React.ReactNode,
} & React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRefIfNeeded<HTMLInputElement, InputProps>(
  ({ className, type, prefixItem, ...props }, ref) => {
    const baseClasses = "flex h-9 w-full rounded-lg border border-black/[0.08] dark:border-white/[0.15] bg-white/45 dark:bg-zinc-900/50 shadow-none px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

    if (prefixItem) {
      return (
        <div className="flex flex-row items-center flex-1">
          <div className={'flex self-stretch justify-center items-center text-muted-foreground pl-3 select-none bg-muted/70 pr-3 border-r border-black/[0.08] dark:border-white/[0.10] rounded-l-lg'}>
            {prefixItem}
          </div>
          <input
            type={type}
            className={cn(baseClasses, 'rounded-l-none', className)}
            ref={ref}
            {...props}
          />
        </div>
      );
    } else {
      return (
        <div className="flex flex-row items-center flex-1">
          <input
            type={type}
            className={cn(baseClasses, className)}
            ref={ref}
            {...props}
          />
        </div>
      );
    }
  }
);
Input.displayName = "Input";
