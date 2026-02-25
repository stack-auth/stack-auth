"use client";

import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { cn } from "@stackframe/stack-ui";
import React from "react";

export const DesignTable = forwardRefIfNeeded<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto rounded-2xl ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
));
DesignTable.displayName = "DesignTable";

export const DesignTableHeader = forwardRefIfNeeded<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-foreground/[0.02] [&_tr]:border-b [&_tr]:border-black/[0.06] dark:[&_tr]:border-white/[0.06]", className)}
    {...props}
  />
));
DesignTableHeader.displayName = "DesignTableHeader";

export const DesignTableBody = forwardRefIfNeeded<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
DesignTableBody.displayName = "DesignTableBody";

export const DesignTableRow = forwardRefIfNeeded<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-black/[0.06] dark:border-white/[0.06] transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.04] data-[state=selected]:bg-foreground/[0.06]",
      className
    )}
    {...props}
  />
));
DesignTableRow.displayName = "DesignTableRow";

export const DesignTableHead = forwardRefIfNeeded<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
));
DesignTableHead.displayName = "DesignTableHead";

export const DesignTableCell = forwardRefIfNeeded<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-4 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
));
DesignTableCell.displayName = "DesignTableCell";
