"use client";

import { MixerHorizontalIcon } from "@radix-ui/react-icons";
import {
    Button,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@stackframe/stack-ui";
import { Table } from "@tanstack/react-table";

type DataTableViewOptionsProps<TData> = {
  table: Table<TData>,
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link",
  className?: string,
  iconClassName?: string,
}

export function DataTableViewOptions<TData>({
  table,
  variant = "outline",
  className = "ml-auto hidden h-8 lg:flex",
  iconClassName = "mr-2 h-4 w-4",
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
              typeof column.accessorFn !== "undefined" && column.getCanHide()
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
