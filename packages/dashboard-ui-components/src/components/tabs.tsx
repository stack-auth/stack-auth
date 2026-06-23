"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn, Spinner } from "@hexclave/ui";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useGlassmorphicDefault } from "./card";

type DesignTabsSize = "sm" | "md";
type DesignTabsGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

export type DesignCategoryTabItem = {
  id: string,
  label: string,
  count?: number,
  badgeCount?: number,
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>,
};

export type DesignCategoryTabsProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  categories: DesignCategoryTabItem[],
  selectedCategory: string,
  onSelect: (id: string) => void | Promise<void>,
  showBadge?: boolean,
  size?: DesignTabsSize,
  glassmorphic?: boolean,
  gradient?: DesignTabsGradient,
  /** Renders inside the tab bar after the tab buttons (not a tab). */
  trailing?: ReactNode,
};

type TabSizeClass = {
  button: string,
  badge: string,
};

type GradientClass = {
  activeText: string,
  activeBadge: string,
  underline: string,
};

type SliderMetrics = {
  left: number,
  width: number,
};

const sliderTransition = "transform 200ms ease-out, width 200ms ease-out";

const tabSizeClasses = new Map<DesignTabsSize, TabSizeClass>([
  ["sm", { button: "px-3 py-2 text-xs", badge: "text-[10px] px-1.5 py-0.5" }],
  ["md", { button: "px-4 py-3 text-sm", badge: "text-xs px-1.5 py-0.5" }],
]);

const gradientClasses = new Map<DesignTabsGradient, GradientClass>([
  [
    "blue",
    {
      activeText: "text-blue-700 dark:text-blue-400",
      activeBadge: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
      underline: "bg-blue-700 dark:bg-blue-400",
    },
  ],
  [
    "cyan",
    {
      activeText: "text-cyan-700 dark:text-cyan-300",
      activeBadge: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300",
      underline: "bg-cyan-600 dark:bg-cyan-400",
    },
  ],
  [
    "purple",
    {
      activeText: "text-purple-700 dark:text-purple-300",
      activeBadge: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
      underline: "bg-purple-600 dark:bg-purple-400",
    },
  ],
  [
    "green",
    {
      activeText: "text-emerald-700 dark:text-emerald-300",
      activeBadge: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
      underline: "bg-emerald-600 dark:bg-emerald-400",
    },
  ],
  [
    "orange",
    {
      activeText: "text-amber-700 dark:text-amber-300",
      activeBadge: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
      underline: "bg-amber-600 dark:bg-amber-400",
    },
  ],
  [
    "default",
    {
      activeText: "text-foreground",
      activeBadge: "bg-foreground/10 text-foreground",
      underline: "bg-foreground/80",
    },
  ],
]);

function getMapValueOrThrow<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, mapName: string) {
  const value = map.get(key);
  if (!value) {
    throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
  }
  return value;
}

export function DesignCategoryTabs({
  categories,
  selectedCategory,
  onSelect,
  showBadge = true,
  size = "sm",
  glassmorphic: glassmorphicProp,
  gradient = "blue",
  trailing,
  className,
  ...props
}: DesignCategoryTabsProps) {
  const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
  const sizeClass = getMapValueOrThrow(tabSizeClasses, size, "tabSizeClasses");
  const gradientClass = getMapValueOrThrow(gradientClasses, gradient, "gradientClasses");
  const [loadingCategoryId, setLoadingCategoryId] = useState<string | null>(null);
  const [sliderMetrics, setSliderMetrics] = useState<SliderMetrics | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const handleSelect = (categoryId: string) => {
    const result = onSelect(categoryId);
    if (result && typeof (result as Promise<void>).then === "function") {
      setLoadingCategoryId(categoryId);
      runAsynchronouslyWithAlert(
        Promise.resolve(result).finally(() => setLoadingCategoryId(null))
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
    const tabList = tabListRef.current;
    const selectedButton = tabButtonRefs.current.get(selectedCategory);

    if (!tabList || !selectedButton) {
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
    resizeObserver.observe(tabList);
    resizeObserver.observe(selectedButton);

    return () => resizeObserver.disconnect();
  }, [categories, selectedCategory]);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2",
        glassmorphic
          ? "rounded-xl bg-zinc-100/90 p-1 ring-1 ring-black/[0.06] backdrop-blur-sm dark:bg-white/[0.04] dark:ring-white/[0.06]"
          : "border-b border-gray-300 dark:border-gray-800",
        className
      )}
      {...props}
    >
      <div
        ref={tabListRef}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 items-center gap-1 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden",
        )}
      >
        {glassmorphic && sliderMetrics != null && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-0 rounded-lg bg-white shadow-sm ring-1 ring-black/[0.12] motion-reduce:transition-none dark:bg-background dark:ring-white/[0.06]"
            style={{
              transition: prefersReducedMotion ? undefined : sliderTransition,
              transform: `translateX(${sliderMetrics.left}px)`,
              width: sliderMetrics.width,
            }}
          />
        )}
        {!glassmorphic && sliderMetrics != null && (
          <div
            className={cn(
              "pointer-events-none absolute bottom-0 left-0 h-0.5 motion-reduce:transition-none",
              gradientClass.underline
            )}
            style={{
              transition: prefersReducedMotion ? undefined : sliderTransition,
              transform: `translateX(${sliderMetrics.left}px)`,
              width: sliderMetrics.width,
            }}
          />
        )}
        {categories.map((category) => {
          const isActive = selectedCategory === category.id;
          const badgeValue = category.badgeCount ?? category.count;
          const shouldShowBadge = showBadge && badgeValue !== undefined;

          return (
            <button
              key={category.id}
              ref={(element) => {
                if (element) {
                  tabButtonRefs.current.set(category.id, element);
                } else {
                  tabButtonRefs.current.delete(category.id);
                }
              }}
              onClick={() => handleSelect(category.id)}
              disabled={loadingCategoryId !== null}
              className={cn(
                "font-medium transition-all duration-150 hover:transition-none relative z-10 flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap",
                "hover:text-gray-900 dark:hover:text-gray-100",
                sizeClass.button,
                glassmorphic ? "rounded-lg" : "",
                isActive
                  ? gradientClass.activeText
                  : cn(
                    "text-gray-700 dark:text-gray-400",
                    glassmorphic && "rounded-lg hover:bg-white/50 dark:hover:bg-white/[0.06]",
                  )
              )}
            >
              {loadingCategoryId === category.id && (
                <Spinner
                  size={12}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                />
              )}
              <span className={cn(
                "flex items-center gap-2",
                loadingCategoryId === category.id && "invisible"
              )}>
                {category.icon && (
                  <category.icon className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {category.label}
                {shouldShowBadge && (
                  <span
                    className={cn(
                      "rounded-full",
                      sizeClass.badge,
                      isActive
                        ? gradientClass.activeBadge
                        : "bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                    )}
                  >
                    {badgeValue}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {trailing != null ? (
        <div className="flex shrink-0 items-center">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
