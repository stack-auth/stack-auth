"use client";

import { cn } from "@stackframe/stack-ui";

export type DesignSkeletonProps = React.HTMLAttributes<HTMLDivElement>;

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
