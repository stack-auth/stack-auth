import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "./utils";

type InputOTPContextValue = {
  value: string,
  maxLength: number,
  disabled?: boolean,
  setValue: (value: string) => void,
};

const InputOTPContext = React.createContext<InputOTPContextValue | null>(null);

function useInputOTPContext() {
  const context = React.useContext(InputOTPContext);
  if (context == null) {
    throw new Error("InputOTPSlot must be rendered inside InputOTP");
  }
  return context;
}

type InputOTPProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "maxLength" | "value"> & {
  value: string,
  onChange: (value: string) => void,
  maxLength: number,
  containerClassName?: string,
  children: React.ReactNode,
};

const InputOTP = forwardRefIfNeeded<HTMLInputElement, InputOTPProps>(
  ({ className, containerClassName, children, value, onChange, maxLength, disabled, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const contextValue = React.useMemo<InputOTPContextValue>(() => ({
      value,
      maxLength,
      disabled,
      setValue: onChange,
    }), [disabled, maxLength, onChange, value]);

    return (
      <InputOTPContext.Provider value={contextValue}>
        <div
          className={cn("stack-scope relative flex items-center gap-2 has-[:disabled]:opacity-50", containerClassName)}
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={(node) => {
              inputRef.current = node;
              if (typeof ref === "function") {
                ref(node);
              } else if (ref != null) {
                ref.current = node;
              }
            }}
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            className={cn("absolute inset-0 h-full w-full cursor-default opacity-0 disabled:cursor-not-allowed", className)}
            onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
            {...props}
          />
          {children}
        </div>
      </InputOTPContext.Provider>
    );
  },
);
InputOTP.displayName = "InputOTP";

const InputOTPGroup = forwardRefIfNeeded<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-1", className)} {...props} />
  ),
);
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = forwardRefIfNeeded<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { index: number, size?: "default" | "lg" }>(
  ({ index, className, size = "default", ...props }, ref) => {
    const context = useInputOTPContext();
    const char = context.value[index] ?? "";
    const isActive = context.value.length === index && context.value.length < context.maxLength && !context.disabled;

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-sm",
          size === "lg" ? "h-10 w-10 text-lg font-medium" : "",
          isActive && "z-10 ring-1 ring-ring",
          className,
        )}
        {...props}
      >
        {char}
        {isActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
          </div>
        )}
      </div>
    );
  },
);
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = forwardRefIfNeeded<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ ...props }, ref) => (
    <div ref={ref} role="separator" {...props}>
      -
    </div>
  ),
);
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
