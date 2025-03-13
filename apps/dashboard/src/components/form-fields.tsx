"use client";
import { cn } from "@/lib/utils";
import { Button, Calendar, Checkbox, FormControl, FormField, FormItem, FormLabel, FormMessage, Input, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from "@stackframe/stack-ui";
import { CalendarIcon } from "lucide-react";
import { Control, FieldValues, Path } from "react-hook-form";


export function FieldLabel(props: {
  children?: React.ReactNode,
  required?: boolean,
  className?: string,
}) {
  return <FormLabel className={cn("flex", props.className)}>
    {props.children}
    {props.required ? <span className="text-zinc-500">{'*'}</span> : null}
  </FormLabel>;
}

export function TextAreaField<F extends FieldValues>(props: {
  rows?: number,
  required?: boolean,
  placeholder?: string,
  helperText?: string | JSX.Element,
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  monospace?: boolean,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <label className="flex flex-col gap-2">
            <FieldLabel required={props.required}>{props.label}</FieldLabel>
            <FormControl>
              <Textarea
                {...field}
                rows={props.rows}
                placeholder={props.placeholder}
                value={field.value ?? ""}
                style={{
                  fontFamily: props.monospace ? "ui-monospace, monospace" : undefined,
                }}
              />
            </FormControl>
            <FormMessage />
          </label>
        </FormItem>
      )}
    />
  );
}

export function InputField<F extends FieldValues>(props: {
  className?: string,
  control: Control<F>,
  name: Path<F>,
  label?: React.ReactNode,
  placeholder?: string,
  required?: boolean,
  type?: string,
  disabled?: boolean,
  prefixItem?: React.ReactNode,
  autoComplete?: string,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className={props.className}>
          <label className="flex flex-col gap-2">
            {props.label ? <FieldLabel required={props.required}>{props.label}</FieldLabel> : null}
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                placeholder={props.placeholder}
                className="max-w-lg"
                disabled={props.disabled}
                type={props.type}
                prefixItem={props.prefixItem}
                autoComplete={props.autoComplete}
              />
            </FormControl>
            <FormMessage />
          </label>
        </FormItem>
      )}
    />
  );
}

export function SwitchField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
  border?: boolean,
  disabled?: boolean,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <label className={cn(
            "flex flex-row items-center gap-2",
            props.border ? "rounded-lg border p-3 shadow-sm" : null
          )}>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={props.disabled}
              />
            </FormControl>
            <FieldLabel required={props.required}>
              {props.label}
            </FieldLabel>
          </label>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchListField<F extends FieldValues>(props: {
  variant?: "switch" | "checkbox",
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  options: { value: string, label: string }[],
  required?: boolean,
  disabled?: boolean,
  info?: string,
}) {
  const Trigger = props.variant === "checkbox" ? Checkbox : Switch;

  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <div className="flex flex-col rounded-lg border p-3 shadow-sm space-y-4">
            {props.options.map(provider => (
              <label className="flex flex-row items-center justify-between" key={provider.value}>
                <FieldLabel required={props.required}>{provider.label}</FieldLabel>
                <FormControl>
                  <Trigger
                    checked={field.value.includes(provider.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        field.onChange([...field.value, provider.value]);
                      } else {
                        field.onChange(field.value.filter((v: any) => v !== provider.value));
                      }
                    }}
                    disabled={props.disabled}
                  />
                </FormControl>
              </label>
            ))}
            {props.info ? <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center px-8">{props.info}</p> : null}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function DateField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
  disabled?: boolean,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FieldLabel required={props.required}>{props.label}</FieldLabel>
          <Popover>
            <PopoverTrigger asChild>
              <FormControl>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] pl-3 text-left font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={props.disabled}
                >
                  {field.value ? field.value.toLocaleDateString() : <span>Pick a date</span>}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={field.value}
                onSelect={field.onChange}
                initialFocus
                disabled={props.disabled}
              />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  options: { value: string, label: string }[],
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
          <FieldLabel required={props.required}>{props.label}</FieldLabel>
          <FormControl>
            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={props.disabled}>
              <SelectTrigger className="max-w-lg">
                <SelectValue placeholder={props.placeholder}/>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.options.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CheckboxField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  description?: string,
  disabled?: boolean,
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-2">
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={props.disabled}
            />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel className={cn(props.disabled && "text-muted-foreground")}>
              {props.label}
            </FormLabel>
            {props.description && (
              <p className="text-sm text-muted-foreground">
                {props.description}
              </p>
            )}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
