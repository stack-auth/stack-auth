import React from "react";
import { cn } from "./utils";

function Skeleton({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "hosted-skeleton block max-w-full min-w-0 rounded-lg",
        className,
      )}
      {...props}
    >
      <div className="invisible inline">
        {children}
      </div>
    </div>
  );
}

export { Skeleton };
