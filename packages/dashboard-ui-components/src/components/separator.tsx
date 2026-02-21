"use client";

import { cn } from "@stackframe/stack-ui";

export type DesignSeparatorProps = {
  orientation?: "horizontal" | "vertical",
} & React.HTMLAttributes<HTMLDivElement>;

export function DesignSeparator({
  orientation = "horizontal",
  className,
  ...props
}: DesignSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        orientation === "horizontal"
          ? "h-[1px] w-full bg-black/[0.08] dark:bg-white/[0.06]"
          : "w-[1px] h-full bg-black/[0.08] dark:bg-white/[0.06]",
        className
      )}
      {...props}
    />
  );
}
