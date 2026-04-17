"use client";

import { useState } from "react";
import { cn, Spinner } from "@stackframe/stack-ui";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useGlassmorphicDefault } from "./card";

type DesignTabsSize = "sm" | "md";
type DesignTabsGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

export type DesignCategoryTabItem = {
  id: string,
  label: string,
  count?: number,
  badgeCount?: number,
};

export type DesignCategoryTabsProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  categories: DesignCategoryTabItem[],
  selectedCategory: string,
  onSelect: (id: string) => void | Promise<void>,
  showBadge?: boolean,
  size?: DesignTabsSize,
  glassmorphic?: boolean,
  gradient?: DesignTabsGradient,
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
  className,
  ...props
}: DesignCategoryTabsProps) {
  const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
  const sizeClass = getMapValueOrThrow(tabSizeClasses, size, "tabSizeClasses");
  const gradientClass = getMapValueOrThrow(gradientClasses, gradient, "gradientClasses");
  const [loadingCategoryId, setLoadingCategoryId] = useState<string | null>(null);

  const handleSelect = (categoryId: string) => {
    const result = onSelect(categoryId);
    if (result && typeof (result as Promise<void>).then === "function") {
      setLoadingCategoryId(categoryId);
      runAsynchronouslyWithAlert(
        Promise.resolve(result).finally(() => setLoadingCategoryId(null))
      );
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden",
        glassmorphic
          ? "rounded-xl bg-black/[0.08] dark:bg-white/[0.04] p-1 backdrop-blur-sm"
          : "border-b border-gray-300 dark:border-gray-800",
        className
      )}
      {...props}
    >
      {categories.map((category) => {
        const isActive = selectedCategory === category.id;
        const badgeValue = category.badgeCount ?? category.count;
        const shouldShowBadge = showBadge && badgeValue !== undefined;

        return (
          <button
            key={category.id}
            onClick={() => handleSelect(category.id)}
            disabled={loadingCategoryId !== null}
            className={cn(
              "font-medium transition-all duration-150 hover:transition-none relative flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap",
              "hover:text-gray-900 dark:hover:text-gray-100",
              sizeClass.button,
              glassmorphic ? "rounded-lg" : "",
              isActive
                ? cn(
                  gradientClass.activeText,
                  glassmorphic && "bg-background shadow-sm ring-1 ring-black/[0.12] dark:ring-white/[0.06]"
                )
                : "text-gray-700 dark:text-gray-400"
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
            {!glassmorphic && isActive && (
              <div className={cn("absolute bottom-0 left-0 right-0 h-0.5", gradientClass.underline)} />
            )}
          </button>
        );
      })}
    </div>
  );
}
