"use client";

import { useEffect, useRef, useState } from "react";
import { cn, Spinner, Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from "@hexclave/ui";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useGlassmorphicDefault } from "./card";

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
  onSelect: (id: string) => void | Promise<void>,
  size?: DesignPillToggleSize,
  glassmorphic?: boolean,
  gradient?: DesignPillToggleGradient,
  /** When false, hides labels and shows a tooltip on hover instead. Defaults to true. */
  showLabels?: boolean,
  className?: string,
};

type SizeClass = {
  button: string,
  iconOnlyButton: string,
  icon: string,
};

type SliderMetrics = {
  left: number,
  width: number,
};

const sliderTransition = "transform 200ms ease-out, width 200ms ease-out";

const sizeClasses = new Map<DesignPillToggleSize, SizeClass>([
  ["sm", { button: "px-3 py-1.5 text-xs", iconOnlyButton: "h-7 w-7 text-xs", icon: "h-3.5 w-3.5" }],
  ["md", { button: "px-4 py-2 text-sm", iconOnlyButton: "h-9 w-9 text-sm", icon: "h-4 w-4" }],
  ["lg", { button: "px-5 py-2.5 text-sm", iconOnlyButton: "h-10 w-10 text-sm", icon: "h-4 w-4" }],
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
  glassmorphic: glassmorphicProp,
  gradient = "default",
  showLabels = true,
  className,
}: DesignPillToggleProps) {
  const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
  const sizeClass = getMapValueOrThrow(sizeClasses, size, "sizeClasses");
  const activeRingClass = getMapValueOrThrow(gradientClasses, gradient, "gradientClasses");

  const [loadingOptionId, setLoadingOptionId] = useState<string | null>(null);
  const [sliderMetrics, setSliderMetrics] = useState<SliderMetrics | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const toggleRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());

  const handleClick = (optionId: string) => {
    const result = onSelect(optionId);
    if (result && typeof (result as Promise<void>).then === "function") {
      setLoadingOptionId(optionId);
      runAsynchronouslyWithAlert(
        Promise.resolve(result).finally(() => setLoadingOptionId(null))
      );
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePrefersReducedMotion = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePrefersReducedMotion();
    mediaQuery.addEventListener("change", updatePrefersReducedMotion);

    return () => mediaQuery.removeEventListener("change", updatePrefersReducedMotion);
  }, []);

  useEffect(() => {
    const toggle = toggleRef.current;
    const selectedButton = optionRefs.current.get(selected);

    if (!toggle || !selectedButton) {
      setSliderMetrics(null);
      return;
    }

    const updateSliderMetrics = () => {
      setSliderMetrics({
        left: selectedButton.offsetLeft,
        width: selectedButton.offsetWidth,
      });
    };

    updateSliderMetrics();

    if (typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(updateSliderMetrics);
    resizeObserver.observe(toggle);
    resizeObserver.observe(selectedButton);

    return () => resizeObserver.disconnect();
  }, [options, selected]);

  const body = (
    <div
      ref={toggleRef}
      className={cn(
        "relative inline-flex items-center gap-1 p-1 rounded-xl",
        glassmorphic
          ? "bg-foreground/[0.04] backdrop-blur-sm"
          : "bg-black/[0.08] dark:bg-white/[0.04]",
        className
      )}
    >
      {sliderMetrics != null && (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-1 left-0 z-0 rounded-lg bg-white dark:bg-background shadow-sm ring-1",
            glassmorphic
              ? "ring-foreground/[0.06] dark:bg-[hsl(240,71%,70%)]/10 dark:ring-[hsl(240,71%,70%)]/20"
              : activeRingClass
          )}
          style={{
            transition: prefersReducedMotion ? undefined : sliderTransition,
            transform: `translateX(${sliderMetrics.left}px)`,
            width: sliderMetrics.width,
          }}
        />
      )}
      {options.map((option) => {
        const isActive = selected === option.id;
        const Icon = option.icon;

        const pill = (
          <button
            type="button"
            key={option.id}
            ref={(element) => {
              if (element) {
                optionRefs.current.set(option.id, element);
              } else {
                optionRefs.current.delete(option.id);
              }
            }}
            onClick={() => handleClick(option.id)}
            disabled={loadingOptionId !== null}
            aria-label={showLabels ? undefined : option.label}
            className={cn(
              "relative z-10 flex items-center gap-2 font-medium rounded-lg transition-all duration-150 hover:transition-none",
              showLabels ? sizeClass.button : sizeClass.iconOnlyButton,
              !showLabels && "justify-center p-0",
              isActive
                ? cn("text-foreground", glassmorphic && "dark:text-[hsl(240,71%,90%)]")
                : cn(
                  "text-muted-foreground hover:text-foreground",
                  glassmorphic
                    ? "hover:bg-background/50"
                    : "hover:bg-black/[0.06] dark:hover:bg-white/[0.04]"
                )
            )}
          >
            {loadingOptionId === option.id && (
              <Spinner
                size={12}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              />
            )}
            <span className={cn(
              "flex items-center gap-2",
              loadingOptionId === option.id && "invisible"
            )}>
              {Icon && <Icon className={sizeClass.icon} />}
              {showLabels && option.label}
            </span>
          </button>
        );

        if (!showLabels) {
          return (
            <Tooltip key={option.id} delayDuration={0}>
              <TooltipTrigger asChild>
                {pill}
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent side="top">
                  {option.label}
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          );
        }

        return pill;
      })}
    </div>
  );

  // Tooltips require a TooltipProvider in scope. Wrap defensively so callers
  // outside an existing provider (e.g. inside a PageLayout actions slot) work.
  return showLabels ? body : <TooltipProvider>{body}</TooltipProvider>;
}
