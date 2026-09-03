"use client";

import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { cn } from "./cn";

/**
 * Button variants mirror the observability dashboard's controls: solid carbon primary, washed panel
 * for secondary actions, and no borders anywhere — depth comes from the tint, not an outline.
 */
export type ButtonVariant = "default" | "outline" | "ghost" | "destructive";

const buttonVariantClasses = new Map<ButtonVariant, string>([
  ["default", "bg-primary text-primary-foreground hover:bg-primary/85"],
  ["outline", "bg-panel-raised text-foreground hover:bg-muted"],
  ["ghost", "text-muted-foreground hover:bg-panel-raised hover:text-foreground"],
  ["destructive", "bg-destructive/15 text-destructive hover:bg-destructive/25"],
]);

export type ButtonSize = "xs" | "sm" | "md";

const buttonSizeClasses = new Map<ButtonSize, string>([
  ["xs", "h-6 rounded-md px-2 text-[11px]"],
  ["sm", "h-7 rounded-lg px-2.5 text-[12px]"],
  ["md", "h-9 rounded-xl px-3.5 text-[13px]"],
]);

export function Button({
  children,
  variant = "outline",
  size = "sm",
  className,
  ...props
}: {
  variant?: ButtonVariant,
  size?: ButtonSize,
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
        "transition-colors hover:transition-none active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-60",
        buttonSizeClasses.get(size) ?? throwErr(`No button classes for size ${size}; buttonSizeClasses must cover every ButtonSize`),
        buttonVariantClasses.get(variant) ?? throwErr(`No button classes for variant ${variant}; buttonVariantClasses must cover every ButtonVariant`),
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Filter chip. `active` is the selected state of a segmented control or multi-select filter row. */
export function Pill({
  children,
  active,
  mono = false,
  className,
  ...props
}: {
  active: boolean,
  mono?: boolean,
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight",
        "transition-colors hover:transition-none",
        mono && "font-mono",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-panel-raised text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

const fieldClasses = cn(
  "w-full rounded-lg bg-panel-raised text-foreground",
  "placeholder:text-faint",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "transition-colors hover:transition-none",
);

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClasses, "h-7 px-2 text-[12px]", className)} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClasses, "px-2 py-1.5 text-[12px]", className)} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(fieldClasses, "h-7 px-2 text-[12px]", className)}>
      {children}
    </select>
  );
}

/** Uppercase micro-label used to the left of filter groups and above form fields. */
export function FieldLabel({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", className)}>
      {children}
    </span>
  );
}

/** Vertical hairline separating filter groups in a toolbar. */
export function Divider({ className }: { className?: string }) {
  return <span className={cn("mx-1.5 h-4 w-px bg-border", className)} />;
}
