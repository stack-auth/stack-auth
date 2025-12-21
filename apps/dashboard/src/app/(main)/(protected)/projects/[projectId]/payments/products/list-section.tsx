"use client";

import { Button, SimpleTooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import React, { ReactNode, useState } from "react";

export type ListSectionProps = {
  title: React.ReactNode,
  titleTooltip?: string,
  onAddClick?: () => void,
  children: ReactNode,
  hasTitleBorder?: boolean,
  searchValue?: string,
  onSearchChange?: (value: string) => void,
  searchPlaceholder?: string,
};

export function ListSection({
  title,
  titleTooltip,
  onAddClick,
  children,
  hasTitleBorder = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search..."
}: ListSectionProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className={cn("sticky top-0 z-10 bg-gray-50/95 dark:bg-background/95 backdrop-blur-sm")}>
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Left: Title */}
          <div className="flex items-center gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {titleTooltip && (
              <SimpleTooltip
                tooltip={titleTooltip}
                type="info"
                inline
                className="mb-[2px]"
                disabled={!titleTooltip}
              />
            )}
          </div>

          {/* Center: Search bar or spacer */}
          {onSearchChange ? (
            <div className="flex-1 flex justify-center">
              <div className={cn(
                "relative flex items-center transition-all duration-150 hover:transition-none",
                isSearchFocused ? "w-[160px]" : "w-[140px]"
              )}>
                <div className="absolute left-2.5 flex items-center justify-center pointer-events-none z-10">
                  <MagnifyingGlassIcon className="h-3 w-3 text-foreground/50" />
                </div>
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className={cn(
                    "w-full h-7 pl-7 pr-2 text-xs rounded-lg",
                    "bg-background dark:bg-foreground/[0.04] border border-border/50 dark:border-foreground/[0.08]",
                    "focus:bg-background dark:focus:bg-foreground/[0.06] focus:outline-none focus:ring-1 focus:ring-foreground/[0.1] focus:border-border dark:focus:border-foreground/[0.12]",
                    "placeholder:text-muted-foreground/50",
                    "transition-all duration-150 hover:transition-none"
                  )}
                />
              </div>
            </div>
          ) : onAddClick ? (
            <div className="flex-1" />
          ) : null}

          {/* Right: Add button */}
          {onAddClick && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 w-7 p-0 rounded-lg shrink-0",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-foreground/[0.06] border border-transparent hover:border-border/40 dark:hover:border-foreground/[0.08]",
                "transition-all duration-150 hover:transition-none"
              )}
              onClick={onAddClick}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
        {hasTitleBorder && <div className="h-px bg-border/50 dark:bg-foreground/[0.08]" />}
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

