"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { useState } from "react";

type DesignSelectorSize = "sm" | "md" | "lg";

export type DesignSelectorOption = {
  value: string,
  label: string,
  disabled?: boolean,
};

export type DesignSelectorOptionGroup = {
  key: string,
  label: string,
  collapsible?: boolean,
  defaultCollapsed?: boolean,
  options: DesignSelectorOption[],
};

export type DesignSelectorDropdownProps = {
  value: string,
  onValueChange: (value: string) => void,
  options?: DesignSelectorOption[],
  groups?: DesignSelectorOptionGroup[],
  disabled?: boolean,
  placeholder?: string,
  size?: DesignSelectorSize,
  className?: string,
  triggerClassName?: string,
  contentClassName?: string,
};

const triggerSizeClasses = new Map<DesignSelectorSize, string>([
  ["sm", "h-8 px-3 text-xs rounded-lg"],
  ["md", "h-9 px-3 text-sm rounded-xl"],
  ["lg", "h-10 px-4 text-sm rounded-xl"],
]);

function getMapValueOrThrow<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, mapName: string) {
  const value = map.get(key);
  if (!value) {
    throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
  }
  return value;
}

export function DesignSelectorDropdown({
  value,
  onValueChange,
  options,
  groups,
  disabled = false,
  placeholder = "Select",
  size = "sm",
  className,
  triggerClassName,
  contentClassName,
}: DesignSelectorDropdownProps) {
  const triggerSizeClass = getMapValueOrThrow(triggerSizeClasses, size, "triggerSizeClasses");

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const g of groups ?? []) {
      if (g.defaultCollapsed) initial.add(g.key);
    }
    return initial;
  });

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className={className}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={cn(triggerSizeClass, triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {options && !groups && options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
          {groups && groups.map((group, gi) => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <SelectGroup key={group.key}>
                {gi > 0 && <SelectSeparator />}
                <SelectLabel
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                    group.collapsible && "cursor-pointer select-none flex items-center gap-1 hover:text-foreground transition-colors"
                  )}
                  onClick={group.collapsible ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleGroup(group.key);
                  } : undefined}
                  onPointerDown={group.collapsible ? (e) => {
                    // Prevent Radix from treating this as item selection
                    e.preventDefault();
                    e.stopPropagation();
                  } : undefined}
                >
                  {group.collapsible && (
                    isCollapsed
                      ? <ChevronRightIcon className="h-3 w-3" />
                      : <ChevronDownIcon className="h-3 w-3" />
                  )}
                  {group.label}
                </SelectLabel>
                {group.options.map((opt) => {
                  const hidden = isCollapsed && opt.value !== value;
                  return (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      disabled={opt.disabled || hidden}
                      className={cn(hidden && "hidden")}
                    >
                      {opt.label}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
