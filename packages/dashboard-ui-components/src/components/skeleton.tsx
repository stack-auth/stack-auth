"use client";

import { cn } from "@stackframe/stack-ui";
import type React from "react";

export type DesignSkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Animated placeholder block. Use while data is loading — size it via
 * `className` to match the content it's standing in for.
 *
 * ```tsx
 * <DesignSkeleton className="h-4 w-[200px]" />
 * <DesignSkeleton className="h-24 w-full rounded-lg" />
 * ```
 *
 * Rule: always show a skeleton during initial load, not a spinner or
 * "Loading..." text. Skeletons preserve layout and feel faster.
 */
export function DesignSkeleton({ className, ...props }: DesignSkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.06]",
        className
      )}
      {...props}
    />
  );
}
