"use client";

import { PanelLeft } from "lucide-react";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { AnimatedSidebarTrigger } from "../motion/animated-sidebar";
import { cn } from "./cn";

/** SpacetimeDB subscription state, as reported by the hooks in src/hooks/useSpacetimeDB.ts. */
export type ConnectionState = "connecting" | "connected" | "error";

/**
 * Every view opens with the same bar: page context on the left, optional toolbar and the live
 * connection pill on the right. The sidebar toggle only appears on mobile, where the nav is a
 * drawer.
 */
export function ViewHeader({
  title,
  subtitle,
  connection,
  toolbar,
}: {
  title: React.ReactNode,
  subtitle?: React.ReactNode,
  connection?: ConnectionState,
  toolbar?: React.ReactNode,
}) {
  return (
    <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <AnimatedSidebarTrigger
          className="size-9 shrink-0 rounded-md text-muted-foreground transition-colors hover:transition-none hover:bg-muted hover:text-foreground md:hidden"
          title="Open sidebar"
        >
          <PanelLeft aria-hidden className="size-4" />
        </AnimatedSidebarTrigger>
        <h1 className="truncate text-[13px] font-medium text-foreground">{title}</h1>
        {subtitle != null && <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
        {toolbar}
        {connection != null && <ConnectionPill state={connection} />}
      </div>
    </header>
  );
}

/** Uppercase micro-label used above every value in a stat tile or detail column. */
export function Eyebrow({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", className)}>
      {children}
    </p>
  );
}

export type DotTone = "success" | "error" | "pending" | "idle";

const dotToneClasses = new Map<DotTone, string>([
  ["success", "bg-success"],
  ["error", "bg-destructive"],
  ["pending", "bg-warning"],
  ["idle", "bg-faint"],
]);

/** A 6px status dot; pending states breathe so in-flight rows read as live. */
export function StatusDot({ tone, className }: { tone: DotTone, className?: string }) {
  const toneClass = dotToneClasses.get(tone)
    ?? throwErr(`No dot classes for tone ${tone}; dotToneClasses must cover every DotTone`);
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      <span className={cn("size-1.5 rounded-full", toneClass)} />
      {tone === "pending" && (
        <span aria-hidden className={cn("absolute inset-0 animate-ping rounded-full opacity-60", toneClass)} />
      )}
    </span>
  );
}

const connectionCopy = new Map<ConnectionState, string>([
  ["connected", "Live"],
  ["connecting", "Connecting"],
  ["error", "Disconnected"],
]);

const connectionTone = new Map<ConnectionState, DotTone>([
  ["connected", "success"],
  ["connecting", "pending"],
  ["error", "error"],
]);

/** Live SpacetimeDB subscription indicator, pinned to the right of every view header. */
export function ConnectionPill({ state }: { state: ConnectionState }) {
  const copy = connectionCopy.get(state)
    ?? throwErr(`No copy for connection state ${state}; connectionCopy must cover every ConnectionState`);
  const tone = connectionTone.get(state)
    ?? throwErr(`No dot tone for connection state ${state}; connectionTone must cover every ConnectionState`);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-panel-raised px-2 py-1 text-[11px] font-medium text-muted-foreground"
      title={copy}
    >
      <StatusDot tone={tone} />
      {copy}
    </span>
  );
}
