import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import React from "react";

import { cn } from "../../lib/utils";

export type InputProps = {
  prefixItem?: React.ReactNode,
} & React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRefIfNeeded<HTMLInputElement, InputProps>(
  ({ className, type, prefixItem, ...props }, ref) => {
    const baseClasses =  "stack-scope flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

    if (prefixItem) {
      return (
        <div className="flex flex-row items-center">
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
    } else {
      return (
        <input
          type={type}
          className={cn(baseClasses, className)}
          ref={ref}
          {...props}
        />
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
