"use client";

import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { cn } from "./cn";
import { Eyebrow } from "./observability";

/**
 * Washed panel matching the observability dashboard's surfaces: a translucent white/black tint on
 * the stage rather than a bordered card, with a hairline only under the optional title row.
 */
export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string,
  actions?: React.ReactNode,
  children: React.ReactNode,
  className?: string,
  bodyClassName?: string,
}) {
  return (
    <div className={cn("rounded-2xl bg-panel", className)}>
      {(title != null || actions != null) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          {title != null && (
            <Eyebrow>{title}</Eyebrow>
          )}
          {actions}
        </div>
      )}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </div>
  );
}

/** Compact KPI tile. `tooltip` renders the same hover explainer the tool used before. */
export function MetricCard({
  label,
  value,
  valueClassName,
  subtitle,
  tooltip,
}: {
  label: string,
  value: string,
  valueClassName?: string,
  subtitle?: string,
  tooltip?: string,
}) {
  return (
    <div className="group relative min-w-0 rounded-2xl bg-panel px-3 py-2.5">
      <Eyebrow>{label}</Eyebrow>
      <p className={cn("tabular mt-1 text-[20px] font-medium tracking-tight", valueClassName ?? "text-foreground")}>{value}</p>
      {subtitle != null && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}
      {tooltip != null && <Tooltip>{tooltip}</Tooltip>}
    </div>
  );
}

/**
 * Hover explainer. Positioned absolutely under its (relatively positioned, `group`-classed) parent
 * and inert to pointer events so it never eats clicks on the element it describes.
 */
export function Tooltip({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode,
  align?: "left" | "right",
  className?: string,
}) {
  return (
    <div
      className={cn(
        "invisible pointer-events-none absolute top-full z-50 mt-1 w-72 rounded-lg px-2.5 py-2 shadow-xl group-hover:visible",
        "bg-surface-overlay text-[11px] font-normal normal-case leading-snug text-foreground ring-1 ring-inset ring-border-strong",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type AlertVariant = "error" | "warning" | "info";

const alertVariantClasses = new Map<AlertVariant, string>([
  ["error", "bg-destructive/10 text-destructive"],
  ["warning", "bg-warning/10 text-warning"],
  ["info", "bg-panel-raised text-muted-foreground"],
]);

/** Inline status/error panel. Uses alerts (not toasts) per repo convention for blocking errors. */
export function Alert({
  variant = "error",
  children,
  className,
}: {
  variant?: AlertVariant,
  children: React.ReactNode,
  className?: string,
}) {
  const variantClasses = alertVariantClasses.get(variant)
    ?? throwErr(`No alert classes for variant ${variant}; alertVariantClasses must cover every AlertVariant`);
  return (
    <div className={cn("rounded-2xl px-3 py-2.5 text-[13px]", variantClasses, className)}>{children}</div>
  );
}

/** Placeholder for "nothing here yet" regions. */
export function EmptyState({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("px-8 py-12 text-center text-[13px] leading-relaxed text-muted-foreground", className)}>{children}</div>
  );
}
