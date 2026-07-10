"use client";

import { cn } from "@/components/ui";
import type { ReactNode } from "react";

/** Continuum-local Railway-inspired surfaces. Scoped so we don't fight the rest of the dashboard. */
export const cx = {
  canvas:
    "relative overflow-hidden rounded-lg border border-black/[0.08] bg-[#0f0e14] text-[#f7f7f8] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:border-white/[0.08]",
  panel:
    "rounded-lg border border-black/[0.08] bg-white/90 dark:border-white/[0.08] dark:bg-[#16141f]/90",
  panelInset:
    "rounded-md border border-black/[0.06] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]",
  hairline: "border-black/[0.08] dark:border-white/[0.08]",
  mono: "font-mono text-[11px] tabular-nums tracking-tight",
  label: "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
  title: "text-sm font-medium tracking-tight text-foreground",
  muted: "text-xs text-muted-foreground",
} as const;

export type CxStatus = "ok" | "warn" | "bad" | "info" | "idle" | "pinned";

const statusDotClass = new Map<CxStatus, string>([
  ["ok", "bg-[#42946e] shadow-[0_0_0_3px_rgba(66,148,110,0.18)]"],
  ["warn", "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]"],
  ["bad", "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"],
  ["info", "bg-[#7c6cff] shadow-[0_0_0_3px_rgba(124,108,255,0.18)]"],
  ["idle", "bg-zinc-400 shadow-[0_0_0_3px_rgba(161,161,170,0.15)]"],
  ["pinned", "bg-violet-400 shadow-[0_0_0_3px_rgba(167,139,250,0.2)]"],
]);

export function StatusDot({ status, className }: { status: CxStatus, className?: string }) {
  const color = statusDotClass.get(status);
  if (color == null) throw new Error(`Unknown Continuum status: ${status}`);
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", color, className)} aria-hidden />;
}

export function CxShell({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {children}
    </div>
  );
}

export function CxHeader({
  title,
  description,
  actions,
}: {
  title: string,
  description?: string,
  actions?: ReactNode,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description != null && (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CxMetricStrip({
  items,
}: {
  items: { label: string, value: string, hint?: string }[],
}) {
  return (
    <div className={cn(cx.panel, "grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0", cx.hairline)}>
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3">
          <p className={cx.label}>{item.label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{item.value}</p>
          {item.hint != null && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function CxPanel({
  title,
  meta,
  children,
  className,
  bodyClassName,
}: {
  title: string,
  meta?: ReactNode,
  children: ReactNode,
  className?: string,
  bodyClassName?: string,
}) {
  return (
    <section className={cn(cx.panel, "flex min-h-0 flex-col overflow-hidden", className)}>
      <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-2.5", cx.hairline)}>
        <h2 className={cx.title}>{title}</h2>
        {meta != null && <div className="shrink-0">{meta}</div>}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function CxChip({ children, tone = "neutral" }: { children: ReactNode, tone?: "neutral" | "ok" | "warn" | "bad" | "accent" }) {
  const toneClass = {
    neutral: "border-black/[0.08] bg-black/[0.03] text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]",
    ok: "border-[#42946e]/30 bg-[#42946e]/10 text-[#2f6b4f] dark:text-[#7dcea8]",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    accent: "border-[#7c6cff]/30 bg-[#7c6cff]/10 text-[#5b4fd6] dark:text-[#b4acff]",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium", toneClass)}>
      {children}
    </span>
  );
}

export function cellStateToCxStatus(state: string): CxStatus {
  switch (state) {
    case "healthy":
    case "deploying": {
      return "ok";
    }
    case "degraded":
    case "isolating":
    case "recovering": {
      return "warn";
    }
    case "failing_over":
    case "protected": {
      return "info";
    }
    case "pinned": {
      return "pinned";
    }
    default: {
      return "idle";
    }
  }
}
