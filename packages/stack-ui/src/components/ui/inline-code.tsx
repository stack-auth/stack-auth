"use client";

import { cn } from "../../lib/utils";
import React from "react";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { hasClickableParent } from "@stackframe/stack-shared/dist/utils/dom";
import { getNodeText } from "@stackframe/stack-shared/dist/utils/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useToast } from "./use-toast";

const InlineCode = forwardRefIfNeeded<
  React.ElementRef<"code">,
  React.ComponentPropsWithoutRef<"code">
>((props, ref) => {
  const { toast }  = useToast();

  return <code
    ref={ref}
    {...props}
    className={cn("stack-scope bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 rounded-sm px-1 cursor-pointer", props.className)}
    onClick={(e: React.MouseEvent<HTMLElement>) => {
      props.onClick?.(e);
      if (!hasClickableParent(e.currentTarget)) {
        e.stopPropagation();
        e.preventDefault();
        runAsynchronously(async () => {
          try {
            await navigator.clipboard.writeText(getNodeText(props.children));
            toast({ description: 'Copied to clipboard!', variant: 'success' });
          } catch (e) {
            toast({ description: 'Failed to copy to clipboard', variant: 'destructive' });
          }
        });
      }
    }}
  />;
});
InlineCode.displayName = "Code";

export { InlineCode };
