import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "./utils";

const labelClasses = "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-zinc-600 dark:text-zinc-400";

const Label = forwardRefIfNeeded<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(labelClasses, className)}
    {...props}
  />
));
Label.displayName = "Label";

const SpanLabel = forwardRefIfNeeded<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(labelClasses, className)}
    {...props}
  />
));
SpanLabel.displayName = "SpanLabel";

export { Label, SpanLabel };
