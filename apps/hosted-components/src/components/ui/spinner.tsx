import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import { LoaderCircle } from "lucide-react";
import React from "react";
import { cn } from "./utils";

export const Spinner = forwardRefIfNeeded<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'> & {
    size?: number,
  }
>(({ size = 15, ...props }, ref) => {
  return (
    <span ref={ref} {...props} className={cn(props.className)}>
      <LoaderCircle className="animate-spin" width={size} height={size} />
    </span>
  );
});
Spinner.displayName = "Spinner";
