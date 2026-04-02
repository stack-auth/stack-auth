"use client";

import { cn } from "@/lib/utils";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input,
} from "@/components/ui";
import { FieldLabel } from "@/components/form-fields";
import { Control, FieldValues, Path } from "react-hook-form";

type CountryCodeInputProps = {
  value: string | null,
  onChange: (value: string | null) => void,
  placeholder?: string,
  disabled?: boolean,
  className?: string,
};

export function CountryCodeInput({
  value,
  onChange,
  placeholder = "e.g. US",
  disabled,
  className,
}: CountryCodeInputProps) {
  return (
    <Input
      value={value ?? ""}
      onChange={(e) => {
        const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
        onChange(val || null);
      }}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={2}
      className={cn("font-mono", className)}
    />
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
              <CountryCodeInput
                value={field.value || null}
                onChange={(val) => field.onChange(val)}
                placeholder={props.placeholder ?? "e.g. US"}
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
