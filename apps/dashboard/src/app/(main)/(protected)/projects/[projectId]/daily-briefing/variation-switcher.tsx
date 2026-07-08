"use client";

import { cn } from "@/components/ui";
import { motion } from "motion/react";
import { useEffect } from "react";

// Floating variation switcher: five full-page design takes on the Daily
// Briefing, flippable by clicking a number or pressing 1-5.

export const VARIATION_LABELS = [
  "Editorial",
  "Bento",
  "Terminal",
  "Broadsheet",
  "Cinema",
] as const;

export function VariationSwitcher({
  active,
  onChange,
}: {
  active: number,
  onChange: (index: number) => void,
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target != null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const num = Number.parseInt(event.key, 10);
      if (num >= 1 && num <= VARIATION_LABELS.length) {
        onChange(num - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/80 p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.08] backdrop-blur-xl dark:bg-background/80 dark:ring-white/[0.1]">
        {VARIATION_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(index)}
            className={cn(
              "relative flex h-9 min-w-9 items-center justify-center rounded-full px-3 font-mono text-sm tabular-nums transition-colors",
              active === index ? "text-background" : "text-foreground/60 hover:text-foreground",
            )}
            title={`${label} (press ${index + 1})`}
          >
            {active === index && (
              <motion.span
                layoutId="variation-switcher-active"
                className="absolute inset-0 rounded-full bg-foreground"
                transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
              />
            )}
            <span className="relative">{index + 1}</span>
            {active === index && (
              <span className="relative ml-1.5 hidden text-xs font-medium sm:inline">{label}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
