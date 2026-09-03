"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme, type Theme } from "../lib/theme";
import { cn } from "./design";

const OPTIONS: Array<{ value: Theme, label: string, icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Three-way theme switch (light / dark / system), same semantics as the dashboard's switch — it
 * writes the shared `theme` localStorage key. Before hydration `theme` reads as "system" on both
 * server and client, so no option is highlighted until `mounted` flips to true.
 */
export function ThemeToggle({ vertical = false }: { vertical?: boolean }) {
  const { theme, setTheme, mounted } = useTheme();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-panel-raised p-0.5",
        vertical && "flex-col",
      )}
    >
      {OPTIONS.map(option => (
        <button
          key={option.value}
          onClick={() => setTheme(option.value)}
          aria-label={`${option.label} theme`}
          aria-pressed={mounted && theme === option.value}
          title={`${option.label} theme`}
          className={cn(
            "grid size-6 place-items-center rounded-full",
            "transition-colors hover:transition-none",
            mounted && theme === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <option.icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
