"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import React from "react";

// ─── Card nesting context ────────────────────────────────────────────────────
// Components with a `glassmorphic` prop use this to auto-detect whether they
// sit inside a DesignCard.  When they do, glassmorphic defaults to `true`;
// when they don't, it defaults to `false`.

const DesignCardNestingContext = React.createContext(false);

/**
 * Returns `true` when the calling component is rendered inside a DesignCard.
 * Useful for deriving a glassmorphic default.
 */
export function useInsideDesignCard(): boolean {
  return React.useContext(DesignCardNestingContext);
}

/**
 * Resolve the effective glassmorphic value.
 * - If the caller passed an explicit boolean → honour it.
 * - Otherwise → fall back to whether we're inside a DesignCard.
 */
export function useGlassmorphicDefault(explicit: boolean | undefined): boolean {
  const insideCard = useInsideDesignCard();
  return explicit ?? insideCard;
}

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

const bodyPaddingClass = "p-5";

// ─── Discriminated props ──────────────────────────────────────────────────
// - If title is given, icon is required.
// - The layout is derived automatically:
//     title + subtitle → "header"   (full header block with subtitle)
//     title only       → "compact"  (slim bar with border-b)
//     no title         → "bodyOnly" (just the body)

type DesignCardBaseProps = {
  glassmorphic?: boolean,
  gradient?: DesignCardGradient,
  contentClassName?: string,
  onClick?: () => void,
} & Omit<React.ComponentProps<typeof Card>, "title" | "onClick">;

type WithTitleProps = {
  title: React.ReactNode,
  subtitle?: React.ReactNode,
  icon: React.ElementType,
  actions?: React.ReactNode,
};

type WithoutTitleProps = {
  title?: never,
  subtitle?: never,
  icon?: never,
  actions?: never,
};

export type DesignCardProps = DesignCardBaseProps & (WithTitleProps | WithoutTitleProps);

export function DesignCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  glassmorphic: glassmorphicProp,
  gradient = "default",
  onClick,
  children,
  className,
  contentClassName,
  ...props
}: DesignCardProps) {
  const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
  const isClickable = onClick != null;
  const [actionHovered, setActionHovered] = React.useState(false);
  const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";
  const suppressHover = isClickable && actionHovered;
  const hasContent = React.Children.count(children) > 0;

  // Derive layout from which props were provided
  const variant = title != null
    ? (subtitle != null ? "header" : "compact")
    : "bodyOnly";

  return (
    <DesignCardNestingContext.Provider value={true}>
      <Card
        className={cn(
          "group relative rounded-2xl overflow-hidden",
          glassmorphic && [
            "bg-white/90 dark:bg-background/60 backdrop-blur-xl border-0",
            "ring-1 ring-black/[0.06] dark:ring-white/[0.06]",
            "shadow-sm",
          ],
          (glassmorphic || isClickable) && "transition-all duration-150 hover:transition-none",
          (glassmorphic || isClickable) && !suppressHover && "hover:ring-black/[0.1] dark:hover:ring-white/[0.1] hover:shadow-md",
          isClickable && !glassmorphic && [
            "ring-1 ring-black/[0.06] dark:ring-white/[0.06] shadow-sm",
          ],
          isClickable && !suppressHover && "cursor-pointer",
          suppressHover && "cursor-default",
          className
        )}
        onClick={suppressHover ? undefined : onClick}
        {...props}
      >
        {glassmorphic && (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" />
            {isClickable && !suppressHover && (
              <div
                className={cn(
                  "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
                  hoverTintClass
                )}
              />
            )}
          </>
        )}
        {isClickable && !glassmorphic && !suppressHover && (
          <div
            className={cn(
              "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
              hoverTintClass
            )}
          />
        )}
        <div className="relative">
          {variant === "header" && (
            <div className={bodyPaddingClass}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {Icon && (
                      <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                        <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
                      </div>
                    )}
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      {title}
                    </span>
                  </div>
                  {subtitle && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {subtitle}
                    </p>
                  )}
                </div>
                {actions && (
                  <div
                    className="flex-shrink-0"
                    onMouseEnter={isClickable ? () => setActionHovered(true) : undefined}
                    onMouseLeave={isClickable ? () => setActionHovered(false) : undefined}
                  >
                    {actions}
                  </div>
                )}
              </div>
            </div>
          )}
          {variant === "compact" && (
            <div className="p-5 flex items-center justify-between gap-4 border-b border-black/[0.12] dark:border-white/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                {Icon && (
                  <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {title}
                </span>
              </div>
              {actions && (
                <div
                  className="flex-shrink-0"
                  onMouseEnter={isClickable ? () => setActionHovered(true) : undefined}
                  onMouseLeave={isClickable ? () => setActionHovered(false) : undefined}
                >
                  {actions}
                </div>
              )}
            </div>
          )}
          {hasContent && (
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
          )}
        </div>
      </Card>
    </DesignCardNestingContext.Provider>
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
