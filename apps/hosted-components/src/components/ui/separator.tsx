import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "./utils";

const Separator = forwardRefIfNeeded<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-black/[0.08] dark:bg-white/[0.08]",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
