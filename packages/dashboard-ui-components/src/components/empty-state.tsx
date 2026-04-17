"use client";

import { cn } from "@stackframe/stack-ui";
import React from "react";

export type DesignEmptyStateProps = {
  icon?: React.ElementType,
  title?: string,
  description?: string,
  children?: React.ReactNode,
  className?: string,
};

/**
 * Centered "no data" placeholder. Show this inside a `DataGrid` via the
 * `emptyState` prop, inside a chart when a query returns zero rows, or
 * inside a card when a section has nothing to display.
 *
 * ```tsx
 * <DesignEmptyState
 *   icon={SearchIcon}
 *   title="No results"
 *   description="Try adjusting your filters."
 * />
 * ```
 *
 * Prefer this over a raw "No data" div — it handles spacing, typography,
 * and the optional icon for you. `icon` is a component type, not a rendered node.
 */
export function DesignEmptyState({
  icon: Icon,
  title = "No data available",
  description,
  children,
  className,
}: DesignEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-4">
          <Icon className="h-10 w-10 text-muted-foreground/30" />
        </div>
      )}
      <h3 className="text-sm font-medium text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-[280px]">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-4">
          {children}
        </div>
      )}
    </div>
  );
}
