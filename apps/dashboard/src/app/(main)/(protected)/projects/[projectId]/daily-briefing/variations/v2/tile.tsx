"use client";

// Shared bento primitives: the Tile shell (accent wash + hover lift + staggered
// entrance), the tiny mono label, and a reduced-motion-aware CountUp.

import { cn } from "@/components/ui";
import { motion, useReducedMotion, animate, type Variants } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

export const EASE = [0.32, 0.72, 0, 1] as const;

export type TileAccent = "blue" | "purple" | "emerald" | "amber" | "cyan" | "rose" | "none";

const ACCENT_WASH: Record<TileAccent, string> = {
  blue: "bg-[radial-gradient(130%_110%_at_0%_0%,rgba(59,130,246,0.09),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_0%_0%,rgba(96,165,250,0.13),transparent_62%)]",
  purple: "bg-[radial-gradient(130%_110%_at_100%_0%,rgba(139,92,246,0.09),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_100%_0%,rgba(167,139,250,0.13),transparent_62%)]",
  emerald: "bg-[radial-gradient(130%_110%_at_0%_100%,rgba(16,185,129,0.09),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_0%_100%,rgba(52,211,153,0.12),transparent_62%)]",
  amber: "bg-[radial-gradient(130%_110%_at_100%_100%,rgba(245,158,11,0.10),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_100%_100%,rgba(251,191,36,0.12),transparent_62%)]",
  cyan: "bg-[radial-gradient(130%_110%_at_50%_0%,rgba(6,182,212,0.09),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_50%_0%,rgba(34,211,238,0.12),transparent_62%)]",
  rose: "bg-[radial-gradient(130%_110%_at_100%_0%,rgba(244,63,94,0.08),transparent_62%)] dark:bg-[radial-gradient(130%_110%_at_100%_0%,rgba(251,113,133,0.11),transparent_62%)]",
  none: "",
};

export const tileVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [...EASE] } },
};

export function Tile(props: {
  accent?: TileAccent,
  className?: string,
  glow?: boolean,
  children: ReactNode,
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={tileVariants}
      whileHover={reduce ? undefined : { y: -4, scale: 1.004 }}
      transition={{ duration: 0.35, ease: [...EASE] }}
      className={cn(
        "group relative overflow-hidden rounded-3xl p-5",
        "bg-white/65 dark:bg-white/[0.035] backdrop-blur-sm",
        "ring-1 ring-black/[0.06] dark:ring-white/[0.08]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_16px_40px_-20px_rgba(0,0,0,0.25)] dark:hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)]",
        props.glow &&
          "ring-2 ring-amber-400/60 dark:ring-amber-300/50 shadow-[0_0_44px_-10px_rgba(251,191,36,0.45)] hover:shadow-[0_0_54px_-8px_rgba(251,191,36,0.55)]",
        props.className,
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0", ACCENT_WASH[props.accent ?? "none"])} />
      <div className="relative flex h-full min-h-0 flex-col">{props.children}</div>
    </motion.div>
  );
}

export function TileLabel(props: { icon?: ReactNode, children: ReactNode, right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/45">
        {props.icon}
        {props.children}
      </span>
      {props.right}
    </div>
  );
}

export function CountUp(props: { to: number, format: (n: number) => string, duration?: number, delay?: number }) {
  const { to, format, duration = 1.6, delay = 0 } = props;
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(() => format(0));

  useEffect(() => {
    if (reduce) {
      setDisplay(format(to));
      return;
    }
    const controls = animate(0, to, {
      duration,
      delay,
      ease: [...EASE],
      onUpdate: (v) => setDisplay(format(Math.round(v))),
    });
    return () => controls.stop();
    // format is expected to be stable (module-scope formatter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduce, duration, delay]);

  return <span className="tabular-nums">{display}</span>;
}

export function DeltaBadge(props: { pct: number }) {
  const { pct } = props;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums",
        pct > 0 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        pct < 0 && "bg-red-500/10 text-red-600 dark:text-red-400",
        pct === 0 && "bg-foreground/[0.06] text-foreground/50",
      )}
    >
      {pct === 0 ? "steady" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`}
    </span>
  );
}
