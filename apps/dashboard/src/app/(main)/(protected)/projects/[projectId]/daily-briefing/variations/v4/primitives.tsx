"use client";

// Typographic primitives for the BROADSHEET variation. Newspaper flavor comes
// exclusively from weight, size, smallcaps tracking, rules, and layout — the
// house ban on italics is absolute.

import { cn } from "@/components/ui";
import type { ReactNode } from "react";

export const SERIF = "[font-family:var(--font-briefing-serif),Georgia,serif]";

export const INK = "text-[color:var(--np-ink)]";
export const MUTED = "text-[color:var(--np-muted)]";
export const FAINT = "text-[color:var(--np-faint)]";
export const RULE = "border-[color:var(--np-rule)]";
export const RULE_STRONG = "border-[color:var(--np-ink)]";
export const ACCENT = "text-[color:var(--np-accent)]";

// Mono smallcaps label — kickers, captions, folios.
export function SmallCaps({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-[0.22em]", className)}>
      {children}
    </span>
  );
}

// "SUPPORT DESK —" style kicker above a headline.
export function Kicker({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <div className={cn("font-mono text-[10px] font-bold uppercase tracking-[0.24em]", MUTED, className)}>
      {children}
    </div>
  );
}

export function Headline({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode,
  className?: string,
  as?: "h1" | "h2" | "h3",
}) {
  return (
    <Tag className={cn(SERIF, "font-bold leading-[1.02] tracking-tight", INK, className)}>
      {children}
    </Tag>
  );
}

// Deck / standfirst under a headline. Upright, lighter, serif.
export function Deck({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <p className={cn(SERIF, "text-sm leading-snug", MUTED, className)}>{children}</p>
  );
}

// "FRANKFURT, 03:12 —" dateline, inline bold lead-in.
export function Dateline({ children }: { children: ReactNode }) {
  return <span className={cn("font-mono text-[11px] font-bold tracking-[0.14em]", INK)}>{children} </span>;
}

// Body copy paragraph.
export function BodyText({ children, className, dropCap }: { children: ReactNode, className?: string, dropCap?: boolean }) {
  return (
    <p
      className={cn(
        SERIF,
        "text-[13.5px] leading-[1.65]",
        INK,
        dropCap &&
          "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-[52px] first-letter:font-bold first-letter:leading-[0.78]",
        className,
      )}
    >
      {children}
    </p>
  );
}

// Bold indented pull quote with thick rules. NOT italic — weight does the work.
export function PullQuote({ children, attribution }: { children: ReactNode, attribution?: string }) {
  return (
    <figure className={cn("my-4 border-y-[3px] px-3 py-3", RULE_STRONG)}>
      <blockquote className={cn(SERIF, "text-lg font-bold leading-snug tracking-tight", INK)}>
        {children}
      </blockquote>
      {attribution ? (
        <figcaption className={cn("mt-2 font-mono text-[9px] tracking-[0.22em]", MUTED)}>{attribution}</figcaption>
      ) : null}
    </figure>
  );
}

// Figure caption — "FIG. 1 — REVENUE, TRAILING 30 DAYS".
export function FigCaption({ children }: { children: ReactNode }) {
  return (
    <figcaption className={cn("mt-2 border-t pt-1.5 font-mono text-[9px] leading-relaxed tracking-[0.18em]", RULE, MUTED)}>
      {children}
    </figcaption>
  );
}

// Section header with double rule, e.g. "SECURITY BLOTTER".
export function SectionHead({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <div className={cn("mb-3 border-y-2 py-1 text-center", RULE_STRONG, className)}>
      <span className={cn("font-mono text-[11px] font-bold uppercase tracking-[0.3em]", INK)}>{children}</span>
    </div>
  );
}

// Thin decorative rule with a centered diamond, classic column divider.
export function Ornament() {
  return (
    <div className="my-4 flex items-center gap-2" aria-hidden>
      <div className={cn("h-px flex-1 border-t", RULE)} />
      <span className={cn("text-[9px] leading-none", MUTED)}>◆</span>
      <div className={cn("h-px flex-1 border-t", RULE)} />
    </div>
  );
}

// Deterministic barcode built from seeded bar widths.
export function Barcode({ bars, className }: { bars: number[], className?: string }) {
  return (
    <div className={cn("flex h-8 items-stretch gap-[2px]", className)} aria-hidden>
      {bars.map((w, i) => (
        <div key={i} className="bg-[color:var(--np-ink)]" style={{ width: w }} />
      ))}
    </div>
  );
}
