"use client";

import { MixerHorizontalIcon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";
import {
  Button,
} from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../dropdown-menu";

type DataTableViewOptionsProps<TData> = {
  table: Table<TData>,
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link",
  className?: string,
  iconClassName?: string,
}

export function DataTableViewOptions<TData>({
  table,
  variant = "secondary",
  className = "ml-auto hidden h-8 px-3 text-xs gap-1.5 lg:flex",
  iconClassName = "h-3.5 w-3.5",
}: DataTableViewOptionsProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={className}
        >
          <MixerHorizontalIcon className={iconClassName} />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter(
            (column) =>
              (typeof column.accessorFn !== "undefined" || "accessorKey" in column.columnDef) && column.getCanHide()
          )
          .map((column) => {
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                className="capitalize"
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

