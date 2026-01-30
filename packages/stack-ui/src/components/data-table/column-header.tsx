import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@stackframe/stack-ui";
import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

type DataTableColumnHeaderProps<TData, TValue> = {
  column: Column<TData, TValue>,
  columnTitle: React.ReactNode,
} & React.HTMLAttributes<HTMLDivElement>

function Item(props: { icon: LucideIcon, onClick: () => void, children: React.ReactNode }) {
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
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="stack-scope">
          <Item icon={ArrowUp} onClick={() => column.toggleSorting(false)}>Asc</Item>
          <Item icon={ArrowDown} onClick={() => column.toggleSorting(true)}>Desc</Item>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
