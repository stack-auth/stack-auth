import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import React from "react";

import { cn } from "@/lib/utils";

export type InputProps = {
  prefixItem?: React.ReactNode,
  leadingIcon?: React.ReactNode,
  size?: "sm" | "md" | "lg",
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">

export const Input = forwardRefIfNeeded<HTMLInputElement, InputProps>(
  ({ className, type, prefixItem, leadingIcon, size = "md", ...props }, ref) => {
    const sizeClasses = size === "sm"
      ? "h-8 px-3 text-xs"
      : size === "lg"
        ? "h-10 px-4 text-sm"
        : "h-9 px-3 text-sm";
    const baseClasses = cn(
      "stack-scope flex w-full rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      "placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-all duration-150 hover:transition-none hover:bg-white dark:hover:bg-foreground/[0.06]",
      sizeClasses
    );

    if (prefixItem) {
      return (
        <div className="flex flex-row items-center flex-1">
          <div className={'flex self-stretch justify-center items-center text-muted-foreground pl-3 select-none bg-muted/70 pr-3 border-r border-input rounded-l-md'}>
            {prefixItem}
          </div>
          <input
            type={type}
            className={cn(baseClasses, 'rounded-l-none', className)}
            ref={ref}
            {...props}
          />
        </div>
      );
    } else if (leadingIcon) {
      return (
        <div className="relative flex flex-row items-center flex-1">
          <div className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground">
            {leadingIcon}
          </div>
          <input
            type={type}
            className={cn(baseClasses, "pl-8", className)}
            ref={ref}
            {...props}
          />
        </div>
      );
    } else {
      return (
        <div className="flex flex-row items-center flex-1">
          <input
            type={type}
            className={cn(baseClasses, className)}
            ref={ref}
            {...props}
          />
        </div>
      );
    }
  }
);
Input.displayName = "Input";


export type DelayedInputProps = {
  delay?: number,
} & InputProps

export const DelayedInput = forwardRefIfNeeded<HTMLInputElement, DelayedInputProps>(
  ({ delay = 500, defaultValue, ...props }, ref) => {
    const [value, setValue] = React.useState(defaultValue ?? "");

    const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
      timeout.current = setTimeout(() => {
        props.onChange?.(e);
      }, delay);
    };

    return <Input ref={ref} {...props} value={value} onChange={onChange} />;
  }
);
DelayedInput.displayName = "DelayedInput";

