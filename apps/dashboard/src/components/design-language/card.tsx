"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DesignCardVariant = "header" | "compact" | "bodyOnly";
type DesignCardSize = "sm" | "md" | "lg";
type DesignCardGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

const hoverTintClasses = new Map<DesignCardGradient, string>([
  ["blue", "group-hover:bg-blue-500/[0.03]"],
  ["purple", "group-hover:bg-purple-500/[0.03]"],
  ["green", "group-hover:bg-emerald-500/[0.03]"],
  ["orange", "group-hover:bg-orange-500/[0.03]"],
  ["default", "group-hover:bg-slate-500/[0.02]"],
  ["cyan", "group-hover:bg-cyan-500/[0.03]"],
]);

const demoTintClasses = new Map<DesignCardGradient, string>([
  ["blue", "group-hover/tint:bg-blue-500/[0.02]"],
  ["purple", "group-hover/tint:bg-purple-500/[0.02]"],
  ["green", "group-hover/tint:bg-emerald-500/[0.02]"],
  ["orange", "group-hover/tint:bg-orange-500/[0.02]"],
  ["default", "group-hover/tint:bg-slate-500/[0.015]"],
  ["cyan", "group-hover/tint:bg-cyan-500/[0.02]"],
]);

const bodyPaddingBySize = new Map<DesignCardSize, string>([
  ["sm", "p-4"],
  ["md", "p-5"],
  ["lg", "p-6"],
]);

export type DesignCardProps = {
  variant?: DesignCardVariant,
  title?: React.ReactNode,
  subtitle?: React.ReactNode,
  icon?: React.ElementType,
  glassmorphic?: boolean,
  size?: DesignCardSize,
  gradient?: DesignCardGradient,
  contentClassName?: string,
} & Omit<React.ComponentProps<typeof Card>, "title">

export function DesignCard({
  variant = "header",
  title,
  subtitle,
  icon: Icon,
  glassmorphic = true,
  size = "md",
  gradient = "default",
  children,
  className,
  contentClassName,
  ...props
}: DesignCardProps) {
  const bodyPaddingClass = bodyPaddingBySize.get(size) ?? "p-5";
  const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";

  return (
    <Card
      className={cn(
        "group relative rounded-2xl overflow-hidden",
        glassmorphic && [
          "bg-white/90 dark:bg-background/60 backdrop-blur-xl border-0 transition-all duration-150 hover:transition-none",
          "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          "shadow-sm hover:shadow-md",
        ],
        className
      )}
      {...props}
    >
      {glassmorphic && (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" />
          <div
            className={cn(
              "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
              hoverTintClass
            )}
          />
        </>
      )}
      <div className="relative">
        {variant === "header" && (
          <div className={bodyPaddingClass}>
            {(title || subtitle || Icon) && (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {(title || Icon) && (
                    <div className="flex items-center gap-2">
                      {Icon && (
                        <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                          <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
                        </div>
                      )}
                      {title && (
                        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                          {title}
                        </span>
                      )}
                    </div>
                  )}
                  {subtitle && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {variant === "compact" && (
          <div className="p-5 flex items-center gap-2 border-b border-black/[0.12] dark:border-white/[0.06]">
            {Icon && (
              <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            {title && (
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                {title}
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            variant === "header" ? "border-t border-black/[0.12] dark:border-white/[0.06]" : "",
            variant === "compact" ? "px-5 py-4" : "",
            variant === "bodyOnly" || variant === "header" ? bodyPaddingClass : "",
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </Card>
  );
}

export type DesignCardTintProps = {
  gradient: DesignCardGradient,
} & React.ComponentProps<"div">

export function DesignCardTint({
  gradient,
  className,
  children,
  ...props
}: DesignCardTintProps) {
  const tintClass = demoTintClasses.get(gradient) ?? "group-hover/tint:bg-slate-500/[0.015]";

  return (
    <div
      className={cn(
        "group/tint relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
        "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
        "shadow-sm hover:shadow-md overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" />
      <div
        className={cn(
          "absolute inset-0 transition-colors duration-150 group-hover/tint:transition-none pointer-events-none rounded-2xl",
          tintClass
        )}
      />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}
