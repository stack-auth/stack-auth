"use client";

import { cn } from "@stackframe/stack-ui";

type DesignProgressBarGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

const fillClasses = new Map<DesignProgressBarGradient, string>([
  ["blue", "bg-blue-500 dark:bg-blue-400"],
  ["cyan", "bg-cyan-500 dark:bg-cyan-400"],
  ["purple", "bg-purple-500 dark:bg-purple-400"],
  ["green", "bg-emerald-500 dark:bg-emerald-400"],
  ["orange", "bg-amber-500 dark:bg-amber-400"],
  ["default", "bg-foreground/60"],
]);

export type DesignProgressBarProps = {
  value: number,
  max?: number,
  gradient?: DesignProgressBarGradient,
  label?: string,
  showPercentage?: boolean,
  size?: "sm" | "md" | "lg",
  className?: string,
};

export function DesignProgressBar({
  value,
  max = 100,
  gradient = "default",
  label,
  showPercentage = false,
  size = "md",
  className,
}: DesignProgressBarProps) {
  const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const fillClass = fillClasses.get(gradient) ?? "bg-foreground/60";

  const trackHeight = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";

  return (
    <div className={cn("w-full", className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-xs font-medium text-muted-foreground">
              {label}
            </span>
          )}
          {showPercentage && (
            <span className="text-xs font-medium tabular-nums text-foreground">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "w-full rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden",
          trackHeight
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300 ease-out",
            fillClass
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
