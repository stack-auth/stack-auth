"use client";

import { cn } from "@stackframe/stack-ui";

export type DesignSeparatorProps = {
  orientation?: "horizontal" | "vertical",
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * Thin divider line. Use `orientation="vertical"` inside a flex row to
 * separate inline groups, or omit for a horizontal rule between sections.
 *
 * ```tsx
 * <DesignSeparator />
 * <DesignSeparator orientation="vertical" className="h-6" />
 * ```
 */
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
