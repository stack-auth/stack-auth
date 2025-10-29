"use client";
import { Input, cn } from "../..";
import { Table } from "@tanstack/react-table";
import { useState } from "react";

export function SearchToolbarItem<TData>(props: { table: Table<TData>, keyName?: string | null, placeholder: string, className?: string }) {
  const [search, setSearch] = useState<string>("");

  return (
    <Input
      placeholder={props.placeholder}
      value={search}
      onChange={(event) => {
        setSearch(event.target.value);
        // run in timeout to prevent immediate re-render
        setTimeout(() => {
          if (props.keyName) {
            props.table.getColumn(props.keyName)?.setFilterValue(event.target.value);
          } else {
            props.table.setGlobalFilter(event.target.value);
          }
        }, 0);
      }}
      className={cn("h-8 w-[250px]", props.className)}
    />
  );
}
