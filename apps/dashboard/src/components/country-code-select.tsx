"use client";

import { cn } from "@/lib/utils";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { FieldLabel } from "@/components/form-fields";
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons";
import { ISO_3166_ALPHA_2_COUNTRY_CODES } from "@stackframe/stack-shared/dist/schema-fields";
import { Control, FieldValues, Path } from "react-hook-form";
import { useState } from "react";

const COUNTRY_CODE_OPTIONS = ISO_3166_ALPHA_2_COUNTRY_CODES.map((code) => ({
  value: code,
  label: code,
}));

type CountryCodeSelectProps = {
  value: string | null,
  onChange: (value: string | null) => void,
  placeholder?: string,
  disabled?: boolean,
  className?: string,
  allowClear?: boolean,
};

export function CountryCodeSelect({
  value,
  onChange,
  placeholder = "Select country code...",
  disabled,
  className,
  allowClear = true,
}: CountryCodeSelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          {value || placeholder}
          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country code..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  Clear
                </CommandItem>
              )}
              {COUNTRY_CODE_OPTIONS.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  {value === option.value && (
                    <CheckIcon className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CountryCodeField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label?: React.ReactNode,
  placeholder?: string,
  required?: boolean,
  disabled?: boolean,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <label className="flex flex-col gap-2">
            {props.label ? <FieldLabel required={props.required}>{props.label}</FieldLabel> : null}
            <FormControl>
              <CountryCodeSelect
                value={field.value || null}
                onChange={(val) => field.onChange(val)}
                placeholder={props.placeholder ?? "Select country code..."}
                disabled={props.disabled}
                className="max-w-lg"
              />
            </FormControl>
            <FormMessage />
          </label>
        </FormItem>
      )}
    />
  );
}
