import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = {} & React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = forwardRefIfNeeded<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "stack-scope flex min-h-[60px] w-full rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06] placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 hover:transition-none hover:bg-white dark:hover:bg-foreground/[0.06] px-3 py-2 text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };

