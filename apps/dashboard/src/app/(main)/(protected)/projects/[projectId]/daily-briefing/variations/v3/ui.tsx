"use client";

// Primitives for Variation 3 — "TERMINAL". Everything mono, phosphor-green /
// amber signal colors in dark, ink-on-paper in light. No italics anywhere.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Severity } from "./data";

// ─── Signal color classes (light "paper terminal" / dark phosphor) ────────────

export const SIG = {
  green: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
  dim: "text-foreground/50",
  faint: "text-foreground/35",
};

export const SEVERITY_CLASS: Record<Severity, string> = {
  OK: SIG.green,
  WARN: SIG.amber,
  CRIT: SIG.red,
};

// ─── Global keyframes + scanline texture ──────────────────────────────────────

export function TerminalStyles() {
  return (
    <style>{`
      @keyframes v3-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
      @keyframes v3-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes v3-sweep { from { left: -30%; } to { left: 100%; } }
      @keyframes v3-led-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
      @media (prefers-reduced-motion: reduce) {
        .v3-anim { animation: none !important; }
      }
    `}</style>
  );
}

export function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 3px)",
      }}
    />
  );
}

// ─── Blinking block cursor ────────────────────────────────────────────────────

export function BlockCursor({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`v3-anim inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-emerald-700 dark:bg-emerald-400 ${className}`}
      style={{ animation: "v3-blink 1.06s step-end infinite" }}
    />
  );
}

// ─── Status LED ───────────────────────────────────────────────────────────────

export function Led({ level, pulse = false }: { level: Severity, pulse?: boolean }) {
  const color =
    level === "OK"
      ? "bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60"
      : level === "WARN"
        ? "bg-amber-600 dark:bg-amber-400 shadow-[0_0_6px] shadow-amber-500/60"
        : "bg-red-600 dark:bg-red-400 shadow-[0_0_6px] shadow-red-500/60";
  return (
    <span
      aria-hidden
      className={`v3-anim inline-block size-1.5 shrink-0 rounded-full ${color}`}
      style={pulse ? { animation: "v3-led-pulse 1.6s ease-in-out infinite" } : undefined}
    />
  );
}

export function SeverityChip({ level }: { level: Severity }) {
  const cls =
    level === "OK"
      ? "border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-400"
      : level === "WARN"
        ? "border-amber-600/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
        : "border-red-600/40 text-red-700 dark:border-red-400/40 dark:text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 border px-1 py-px text-[9px] font-semibold tracking-widest ${cls}`}>
      <Led level={level} />
      {level}
    </span>
  );
}

// ─── Type-in effect (staggered boot reveal) ───────────────────────────────────

export function TypeIn({
  text,
  delayMs = 0,
  speed = 18,
  className = "",
}: {
  text: string,
  delayMs?: number,
  speed?: number, // ms per char
  className?: string,
}) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? text.length : 0);
  const [started, setStarted] = useState(reduce ?? false);

  useEffect(() => {
    if (reduce) {
      setCount(text.length);
      setStarted(true);
      return;
    }
    const startTimer = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(startTimer);
  }, [reduce, delayMs, text.length]);

  useEffect(() => {
    if (!started || count >= text.length) return;
    const t = setTimeout(() => setCount((c) => Math.min(text.length, c + 1)), speed);
    return () => clearTimeout(t);
  }, [started, count, text.length, speed]);

  const done = count >= text.length;
  return (
    <span className={className}>
      {text.slice(0, count)}
      {!done && started && <BlockCursor className="ml-0.5 h-[0.85em]" />}
    </span>
  );
}

// ─── Ticking number (count-up on mount, tabular-nums) ─────────────────────────

export function TickNumber({
  value,
  format,
  durationMs = 1100,
  className = "",
}: {
  value: number,
  format: (n: number) => string,
  durationMs?: number,
  className?: string,
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    let start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [value, durationMs, reduce]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}

// ─── Panel chrome ─────────────────────────────────────────────────────────────

export function Panel({
  index,
  title,
  right,
  children,
  className = "",
  span = "",
}: {
  index: string,
  title: string,
  right?: React.ReactNode,
  children: React.ReactNode,
  className?: string,
  span?: string,
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative flex flex-col border border-foreground/15 bg-white/55 dark:border-emerald-400/15 dark:bg-emerald-950/[0.14] ${span} ${className}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-dashed border-foreground/15 px-3 py-1.5 dark:border-emerald-400/15">
        <h2 className="truncate text-[10px] font-semibold tracking-[0.18em] text-foreground/70">
          <span className={SIG.green}>[{index}]</span> {title}
        </h2>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </header>
      <div className="flex-1 p-3">{children}</div>
    </motion.section>
  );
}

// ─── Toggle switch (delivery modes) ───────────────────────────────────────────

export function TermSwitch({
  label,
  checked,
  onChange,
}: {
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-1.5 text-[10px] tracking-widest"
    >
      <span
        className={`relative inline-flex h-3.5 w-7 items-center border transition-colors ${
          checked
            ? "border-emerald-600/50 bg-emerald-600/15 dark:border-emerald-400/50 dark:bg-emerald-400/10"
            : "border-foreground/25 bg-foreground/5"
        }`}
      >
        <span
          className={`absolute h-2 w-2.5 transition-transform ${
            checked
              ? "translate-x-[15px] bg-emerald-600 dark:bg-emerald-400"
              : "translate-x-[2px] bg-foreground/40"
          }`}
        />
      </span>
      <span className={checked ? SIG.green : SIG.dim}>{label}</span>
      <span className={`font-semibold ${checked ? SIG.green : SIG.faint}`}>{checked ? "ON" : "OFF"}</span>
    </button>
  );
}

// ─── ASCII-feel divider ───────────────────────────────────────────────────────

export function Rule({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-foreground/30" aria-hidden>
      <span className="h-px flex-1 border-t border-dashed border-current" />
      {label && <span className="text-[9px] tracking-[0.25em]">{label}</span>}
      {label && <span className="h-px flex-1 border-t border-dashed border-current" />}
    </div>
  );
}
