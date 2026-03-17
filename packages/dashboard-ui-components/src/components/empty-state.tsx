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
