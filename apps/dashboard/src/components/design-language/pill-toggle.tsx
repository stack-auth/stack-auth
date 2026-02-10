"use client";

import { cn } from "@/lib/utils";

type DesignPillToggleSize = "sm" | "md" | "lg";
type DesignPillToggleGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

export type DesignPillToggleOption = {
  id: string,
  label: string,
  icon?: React.ElementType,
};

export type DesignPillToggleProps = {
  options: DesignPillToggleOption[],
  selected: string,
  onSelect: (id: string) => void,
  size?: DesignPillToggleSize,
  glassmorphic?: boolean,
  gradient?: DesignPillToggleGradient,
  className?: string,
};

type SizeClass = {
  button: string,
  icon: string,
};

const sizeClasses = new Map<DesignPillToggleSize, SizeClass>([
  ["sm", { button: "px-3 py-1.5 text-xs", icon: "h-3.5 w-3.5" }],
  ["md", { button: "px-4 py-2 text-sm", icon: "h-4 w-4" }],
  ["lg", { button: "px-5 py-2.5 text-sm", icon: "h-4 w-4" }],
]);

const gradientClasses = new Map<DesignPillToggleGradient, string>([
  ["blue", "ring-blue-500/20 dark:ring-blue-400/20"],
  ["cyan", "ring-cyan-500/20 dark:ring-cyan-400/20"],
  ["purple", "ring-purple-500/20 dark:ring-purple-400/20"],
  ["green", "ring-emerald-500/20 dark:ring-emerald-400/20"],
  ["orange", "ring-amber-500/20 dark:ring-amber-400/20"],
  ["default", "ring-black/[0.12] dark:ring-white/[0.06]"],
]);

function getMapValueOrThrow<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, mapName: string) {
  const value = map.get(key);
  if (!value) {
    throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
  }
  return value;
}

export function DesignPillToggle({
  options,
  selected,
  onSelect,
  size = "md",
  glassmorphic = false,
  gradient = "default",
  className,
}: DesignPillToggleProps) {
  const sizeClass = getMapValueOrThrow(sizeClasses, size, "sizeClasses");
  const activeRingClass = getMapValueOrThrow(gradientClasses, gradient, "gradientClasses");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 p-1",
        glassmorphic
          ? "rounded-xl bg-black/[0.08] dark:bg-white/[0.04] backdrop-blur-sm"
          : "rounded-xl bg-black/[0.08] dark:bg-white/[0.04]",
        className
      )}
    >
      {options.map((option) => {
        const isActive = selected === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex items-center gap-2 font-medium rounded-lg transition-all duration-150 hover:transition-none",
              sizeClass.button,
              isActive
                ? cn("bg-background text-foreground shadow-sm ring-1", activeRingClass)
                : "text-muted-foreground hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.04]"
            )}
          >
            {Icon && <Icon className={sizeClass.icon} />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
