import { Input, cn } from "../..";
import { Table } from "@tanstack/react-table";

export function SearchToolbarItem<TData>(props: { table: Table<TData>, keyName?: string | null, placeholder: string, className?: string }) {
  return (
    <Input
      placeholder={props.placeholder}
      value={props.keyName ? `${props.table.getColumn(props.keyName)?.getFilterValue() ?? ""}` : props.table.getState().globalFilter ?? ""}
      onChange={(event) => props.keyName ? props.table.getColumn(props.keyName)?.setFilterValue(event.target.value) : props.table.setGlobalFilter(event.target.value)}
      className={cn("h-8 w-[250px]", props.className)}
    />
  );
}
