"use client";

import React from "react";
import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = forwardRefIfNeeded<
  void,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>
>((props, ref) => (
  <TooltipPrimitive.Provider
    delayDuration={0}
    {...props}
  />
));
TooltipProvider.displayName = TooltipPrimitive.Provider.displayName;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRefIfNeeded<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "stack-scope z-50 overflow-hidden rounded-md border border-black/[0.08] bg-white px-3 py-1.5 text-xs text-foreground shadow-md ring-1 ring-black/[0.06] dark:border-white/[0.08] dark:bg-primary dark:text-primary-foreground dark:ring-white/[0.08] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
