"use client";

import { Spinner, Typography, cn } from "@/components/ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons";
import { useState, type ReactNode } from "react";

export type ComboboxItem = {
  value: string,
  label: string,
  description?: string,
  trailingIcon?: ReactNode,
};

type Props = {
  value: string,
  items: ComboboxItem[],
  onSelect: (value: string) => void,
  query: string,
  onQueryChange: (query: string) => void,
  triggerPlaceholder?: string,
  inputPlaceholder?: string,
  emptyMessage?: string,
  loading?: boolean,
  disabled?: boolean,
};

export function RemoteSearchCombobox(props: Props) {
  const [open, setOpen] = useState(false);
  const selectedLabel = props.items.find((item) => item.value === props.value)?.label ?? props.value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={props.disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-xl",
            "border border-black/[0.08] bg-white/80 px-3 py-2 text-sm shadow-sm ring-1 ring-black/[0.08]",
            "transition-all duration-150 hover:transition-none hover:ring-black/[0.12]",
            "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-white/[0.06] dark:bg-background/60 dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          )}
        >
          <span className={cn("truncate text-left", selectedLabel.length === 0 && "text-muted-foreground")}>
            {selectedLabel.length > 0 ? selectedLabel : (props.triggerPlaceholder ?? "Select")}
          </span>
          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={props.inputPlaceholder ?? "Search..."}
            value={props.query}
            onValueChange={props.onQueryChange}
          />
          <CommandList>
            {props.loading && (
              <div className="flex items-center gap-2 px-3 py-3">
                <Spinner size={14} />
                <Typography variant="secondary" className="text-sm">Searching...</Typography>
              </div>
            )}
            {!props.loading && props.items.length === 0 && (
              <CommandEmpty>{props.emptyMessage ?? "No results."}</CommandEmpty>
            )}
            {props.items.length > 0 && (
              <CommandGroup>
                {props.items.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={item.value}
                    onSelect={() => {
                      props.onSelect(item.value);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        props.value === item.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{item.label}</div>
                      {item.description != null && (
                        <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                      )}
                    </div>
                    {item.trailingIcon != null && (
                      <span className="ml-2 flex shrink-0 items-center text-muted-foreground">
                        {item.trailingIcon}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
