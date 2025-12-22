"use client";

import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react/dist/ssr";
import { Column } from "@tanstack/react-table";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { Button } from "../button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu";

import { cn } from "@/lib/utils";

type DataTableColumnHeaderProps<TData, TValue> = {
  column: Column<TData, TValue>,
  columnTitle: ReactNode,
} & HTMLAttributes<HTMLDivElement>

function Item(props: { icon: ComponentType<{ className?: string }>, onClick: () => void, children: ReactNode }) {
  return (
    <DropdownMenuItem onClick={props.onClick}>
      <div className="flex items-center">
        <props.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
        {props.children}
      </div>
    </DropdownMenuItem>
  );
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  columnTitle,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("-ml-3 h-8 data-[state=open]:bg-accent", !column.getCanSort() && "pointer-events-none")}
          >
            <span>{columnTitle}</span>
            {column.getIsSorted() === "desc" ? (
              <ArrowDownIcon className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUpIcon className="ml-2 h-4 w-4" />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="stack-scope">
          <Item icon={ArrowUpIcon} onClick={() => column.toggleSorting(false)}>Asc</Item>
          <Item icon={ArrowDownIcon} onClick={() => column.toggleSorting(true)}>Desc</Item>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
