"use client";

import { cn } from "@/lib/utils";
import { Button, SimpleTooltip } from "@stackframe/stack-ui";
import { Plus, Search } from "lucide-react";
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
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
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
          <div className="flex items-center gap-2">
            {onSearchChange && (
              <div className={cn(
                "relative flex items-center transition-all duration-150 hover:transition-none",
                isSearchFocused ? "w-[180px]" : "w-[150px]"
              )}>
                <div className="absolute left-3 flex items-center justify-center pointer-events-none z-10">
                  <Search className="h-4 w-4 text-foreground/60" />
                </div>
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className={cn(
                    "w-full h-9 pl-10 pr-3 text-sm rounded-xl",
                    "bg-background dark:bg-foreground/[0.04] border border-border/50 dark:border-foreground/[0.08]",
                    "focus:bg-background dark:focus:bg-foreground/[0.06] focus:outline-none focus:ring-1 focus:ring-foreground/[0.1] focus:border-border dark:focus:border-foreground/[0.12]",
                    "placeholder:text-muted-foreground/60",
                    "transition-all duration-150 hover:transition-none"
                  )}
                />
              </div>
            )}
            {onAddClick && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 w-9 p-0 rounded-xl",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-foreground/[0.06] border border-transparent hover:border-border/40 dark:hover:border-foreground/[0.08]",
                  "transition-all duration-150 hover:transition-none"
                )}
                onClick={onAddClick}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {hasTitleBorder && <div className="h-px bg-border/50 dark:bg-foreground/[0.08]" />}
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

