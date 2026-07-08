"use client";

import { cn } from "@/components/ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// Tiny editorial primitives shared by the Variation 1 chapters. Print-like:
// hairlines, mono smallcaps captions, quiet ghost buttons.

export const EDITORIAL_EASE = [0.32, 0.72, 0, 1] as const;

export const SERIF = "[font-family:var(--font-briefing-serif),Georgia,serif]";

// Mono smallcaps caption line, Dia-style.
export function Caption({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/40", className)}>
      {children}
    </span>
  );
}

// Quiet inline action — a text button with a hairline underline offset.
export function GhostAction({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/60 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60 disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

// A slightly firmer editorial button (still no filled pill — print, not app).
export function RuledButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-2 border border-foreground/20 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/80 transition-colors hover:border-foreground/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

// Monogram square used for companies/people — engraving-plate style.
export function Monogram({ letters, className }: { letters: string, className?: string }) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center border border-foreground/15 bg-foreground/[0.03] font-mono text-xs tracking-[0.1em] text-foreground/70 dark:bg-foreground/[0.06]",
        className,
      )}
    >
      {letters}
    </span>
  );
}

// Hairline divider between rows inside a chapter.
export function Hairline({ className }: { className?: string }) {
  return <div className={cn("border-t border-black/[0.07] dark:border-white/[0.08]", className)} />;
}
