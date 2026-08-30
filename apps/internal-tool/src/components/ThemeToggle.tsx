"use client";

import { useTheme, type Theme } from "../lib/theme";
import { cn } from "./design";

const OPTIONS: Array<{ value: Theme, label: string, icon: string }> = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "⌘" },
];

/**
 * Three-way theme switch (light / dark / system), same semantics as the dashboard's switch — it
 * writes the shared `theme` localStorage key. Before hydration `theme` reads as "system" on both
 * server and client, so no option is highlighted until `mounted` flips to true.
 */
export function ThemeToggle() {
  const { theme, setTheme, mounted } = useTheme();

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-card p-0.5 ring-1 ring-black/[0.04] dark:border-white/[0.08] dark:ring-white/[0.04]">
      {OPTIONS.map(option => (
        <button
          key={option.value}
          onClick={() => setTheme(option.value)}
          aria-label={`${option.label} theme`}
          aria-pressed={mounted && theme === option.value}
          title={`${option.label} theme`}
          className={cn(
            "h-6 w-6 rounded-full text-[11px] leading-none",
            "transition-colors hover:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            mounted && theme === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
