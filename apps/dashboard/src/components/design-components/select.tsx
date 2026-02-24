"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DesignSelectorSize = "sm" | "md" | "lg";

export type DesignSelectorOption = {
  value: string,
  label: string,
  disabled?: boolean,
};

export type DesignSelectorDropdownProps = {
  value: string,
  onValueChange: (value: string) => void,
  options: DesignSelectorOption[],
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
  disabled = false,
  placeholder = "Select",
  size = "sm",
  className,
  triggerClassName,
  contentClassName,
}: DesignSelectorDropdownProps) {
  const triggerSizeClass = getMapValueOrThrow(triggerSizeClasses, size, "triggerSizeClasses");

  return (
    <div className={className}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={cn(triggerSizeClass, triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
