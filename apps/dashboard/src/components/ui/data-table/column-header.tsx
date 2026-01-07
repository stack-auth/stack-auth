"use client";

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { Column } from "@tanstack/react-table";
import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "../button";

import { cn } from "@/lib/utils";

type DataTableColumnHeaderProps<TData, TValue> = {
  column: Column<TData, TValue>,
  columnTitle: ReactNode,
} & HTMLAttributes<HTMLDivElement>

export function DataTableColumnHeader<TData, TValue>({
  column,
  columnTitle,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{columnTitle}</div>;
  }

  const sorted = column.getIsSorted();

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        className={cn("-ml-3 h-8 hover:bg-accent/50 group", sorted && "text-foreground")}
        onClick={() => column.toggleSorting(sorted === "asc")}
      >
        <span>{columnTitle}</span>
        <div className="ml-2 flex flex-col -space-y-1">
          <CaretUpIcon
            weight="fill"
            className={cn(
              "h-2.5 w-2.5 transition-colors",
              sorted === "asc" ? "text-foreground" : "text-muted-foreground/30 group-hover:text-muted-foreground/50"
            )}
          />
          <CaretDownIcon
            weight="fill"
            className={cn(
              "h-2.5 w-2.5 transition-colors",
              sorted === "desc" ? "text-foreground" : "text-muted-foreground/30 group-hover:text-muted-foreground/50"
            )}
          />
        </div>
      </Button>
    </div>
  );
}
