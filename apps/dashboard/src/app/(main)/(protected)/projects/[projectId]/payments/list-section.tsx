"use client";

import { cn } from "@/lib/utils";
import { Button, Input, SimpleTooltip } from "@stackframe/stack-ui";
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
      <div className={cn("sticky top-0 z-10")}>
        <div className="flex items-center justify-between pl-3 pr-1 py-1">
          <div className="flex items-center">
            <h2 className="font-medium">{title}</h2>
            {titleTooltip && (
              <SimpleTooltip
                tooltip={titleTooltip}
                type="info"
                inline
                className="ml-2 mb-[2px] translate-y-[-1px]"
                disabled={!titleTooltip}
              />
            )}
          </div>
          {onSearchChange && (
            <div>
              <div className={cn(
              "relative transition-all",
              isSearchFocused ? "max-w-[200px]" : "max-w-[140px]"
            )}>
                <Search className={cn(
                "absolute left-2.5 text-muted-foreground transition-all duration-200",
                isSearchFocused ? "top-[6px] h-4 w-4" : "top-[6px] h-3 w-3.5"
              )} />
                <Input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className={cn(
                  "pl-8 bg-secondary/30 border-transparent focus:bg-secondary/50 transition-all duration-200",
                  isSearchFocused ? "h-7 text-sm" : "h-6 text-xs"
                )}
                />
              </div>
            </div>
          )}
          {onAddClick && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onAddClick}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        {hasTitleBorder && <div className="border-b" />}
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

