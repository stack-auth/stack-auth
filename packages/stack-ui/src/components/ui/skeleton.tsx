"use client";

import React from "react";
import { cn } from "../../lib/utils";

function Skeleton({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("stack-scope animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    >
      <div className="invisible inline">
        {children}
      </div>
    </div>
  );
}

export { Skeleton };
