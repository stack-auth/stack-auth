"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
} from "@/components/ui";
import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";
import { EditableInput } from "./editable-input";

// Base item props shared by all types
type BaseItemProps = {
  itemKey?: string,
  icon: React.ReactNode,
  name: string,
  tooltip?: string,
};

// Text input item
type TextItem = BaseItemProps & {
  type: 'text',
  value: string,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
};

// Boolean dropdown item (Yes/No)
type BooleanItem = BaseItemProps & {
  type: 'boolean',
  value: boolean,
  onUpdate?: (value: boolean) => Promise<void>,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
};

// Dropdown option with optional disabled state
type DropdownOption = {
  value: string,
  label: string,
  disabled?: boolean,
  disabledReason?: string,
};

// Dropdown with predefined options
type DropdownItem = BaseItemProps & {
  type: 'dropdown',
  value: string,
  options: DropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  extraAction?: {
    label: string,
    onClick: () => void,
  },
};

// Custom dropdown (like Free Trial) - you provide trigger text and popover content
type CustomDropdownItem = BaseItemProps & {
  type: 'custom-dropdown',
  triggerContent: React.ReactNode,
  popoverContent: React.ReactNode,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  disabled?: boolean,
};

// Custom button (like Add-on) - custom onClick and custom render
type CustomButtonItem = BaseItemProps & {
  type: 'custom-button',
  children: React.ReactNode,
  onClick: () => void,
  disabled?: boolean,
};

// Fully custom content (like Prices/Included Items)
type CustomContentItem = BaseItemProps & {
  type: 'custom',
  children: React.ReactNode,
};

export type EditableGridItem =
  | TextItem
  | BooleanItem
  | DropdownItem
  | CustomDropdownItem
  | CustomButtonItem
  | CustomContentItem;

type EditableGridProps = {
  items: EditableGridItem[],
  columns?: 1 | 2,
  className?: string,
  deferredSave?: boolean,
  hasChanges?: boolean,
  onSave?: () => Promise<void>,
  onDiscard?: () => void,
  externalModifiedKeys?: Set<string>,
};

// Reusable label component
function GridLabel({
  icon,
  name,
  tooltip,
  isModified,
}: {
  icon: React.ReactNode,
  name: string,
  tooltip?: string,
  isModified?: boolean,
}) {
  const label = (
    <span className="flex h-8 items-center gap-2 text-xs font-semibold text-foreground">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-foreground/[0.04] text-muted-foreground">
        {icon}
      </span>
      <span className="whitespace-nowrap mr-2">{name}</span>
      {isModified && (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
    </span>
  );

  if (tooltip) {
    return (
      <SimpleTooltip tooltip={tooltip}>
        {label}
      </SimpleTooltip>
    );
  }

  return label;
}

// Editable boolean dropdown component
function EditableBooleanField({
  value,
  onUpdate,
  readOnly,
  trueLabel = 'Yes',
  falseLabel = 'No',
}: {
  value: boolean,
  onUpdate?: (value: boolean) => Promise<void>,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
}) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleChange = async (newValue: string) => {
    if (!onUpdate) return;
    setIsUpdating(true);
    try {
      await onUpdate(newValue === 'true');
    } finally {
      setIsUpdating(false);
    }
  };

  if (readOnly) {
    return (
      <span className="inline-flex h-8 items-center rounded-xl bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] px-3 text-sm text-muted-foreground shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]">
        {value ? trueLabel : falseLabel}
      </span>
    );
  }

  return (
    <Select
      value={value ? 'true' : 'false'}
      onValueChange={(v) => runAsynchronouslyWithAlert(handleChange(v))}
      disabled={isUpdating}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-full rounded-xl px-3 text-sm text-foreground",
          "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
          "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
          "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
          "transition-colors duration-150 hover:transition-none",
          "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="true">{trueLabel}</SelectItem>
        <SelectItem value="false">{falseLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Editable dropdown field component
function EditableDropdownField({
  value,
  options,
  onUpdate,
  readOnly,
  extraAction,
}: {
  value: string,
  options: DropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  extraAction?: { label: string, onClick: () => void },
}) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleChange = async (newValue: string) => {
    if (!onUpdate) return;
    setIsUpdating(true);
    try {
      await onUpdate(newValue);
    } finally {
      setIsUpdating(false);
    }
  };

  const selectedOption = options.find(o => o.value === value);

  if (readOnly) {
    return (
      <span className="inline-flex h-8 items-center rounded-xl bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] px-3 text-sm text-muted-foreground shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]">
        {selectedOption?.label ?? value}
      </span>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => runAsynchronouslyWithAlert(handleChange(v))}
      disabled={isUpdating}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-full rounded-xl px-3 text-sm text-foreground",
          "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
          "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
          "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
          "transition-colors duration-150 hover:transition-none",
          "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const item = (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={option.disabled ? "opacity-50" : undefined}
            >
              {option.label}
            </SelectItem>
          );
          if (option.disabled && option.disabledReason) {
            return (
              <SimpleTooltip key={option.value} tooltip={option.disabledReason}>
                <div>{item}</div>
              </SimpleTooltip>
            );
          }
          return item;
        })}
        {extraAction && (
          <>
            <div className="h-px bg-border my-1" />
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-sm text-primary hover:bg-accent rounded-sm cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                extraAction.onClick();
              }}
            >
              {extraAction.label}
            </button>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// Custom button field component
function CustomButtonField({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode,
  onClick: () => void,
  disabled?: boolean,
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 w-full rounded-xl px-3 text-left text-sm text-foreground",
        "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        !disabled && "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] hover:cursor-pointer",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
        "transition-colors duration-150 hover:transition-none",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

// Custom dropdown field (trigger + popover handled externally via open/onOpenChange)
function CustomDropdownField({
  triggerContent,
  disabled,
}: {
  triggerContent: React.ReactNode,
  disabled?: boolean,
}) {
  return (
    <button
      disabled={disabled}
      className={cn(
        "h-8 w-full rounded-xl px-3 text-left text-sm text-foreground",
        "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        !disabled && "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] hover:cursor-pointer",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
        "transition-colors duration-150 hover:transition-none",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {triggerContent}
    </button>
  );
}

// Render a single grid item's value
function GridItemValue({ item }: { item: EditableGridItem }) {
  switch (item.type) {
    case 'text': {
      return (
        <EditableInput
          value={item.value}
          onUpdate={item.onUpdate}
          readOnly={item.readOnly}
          placeholder={item.placeholder}
        />
      );
    }

    case 'boolean': {
      return (
        <EditableBooleanField
          value={item.value}
          onUpdate={item.onUpdate}
          readOnly={item.readOnly}
          trueLabel={item.trueLabel}
          falseLabel={item.falseLabel}
        />
      );
    }

    case 'dropdown': {
      return (
        <EditableDropdownField
          value={item.value}
          options={item.options}
          onUpdate={item.onUpdate}
          readOnly={item.readOnly}
          extraAction={item.extraAction}
        />
      );
    }

    case 'custom-dropdown': {
      return (
        <CustomDropdownField
          triggerContent={item.triggerContent}
          disabled={item.disabled}
        />
      );
    }

    case 'custom-button': {
      return (
        <CustomButtonField
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {item.children}
        </CustomButtonField>
      );
    }

    case 'custom': {
      return <>{item.children}</>;
    }
  }
}

export function EditableGrid({
  items,
  columns = 2,
  className,
  deferredSave,
  hasChanges,
  onSave,
  onDiscard,
  externalModifiedKeys,
}: EditableGridProps) {
  const gridCols = columns === 1
    ? "grid-cols-[min-content_1fr]"
    : "grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr]";

  return (
    <div className="space-y-2">
      <div className={cn(
        "grid gap-x-6 gap-y-3 text-sm items-center",
        gridCols,
        className
      )}>
        {items.map((item, index) => (
          <GridItemContent
            key={index}
            item={item}
            isModified={item.itemKey ? externalModifiedKeys?.has(item.itemKey) : false}
          />
        ))}
      </div>
      {deferredSave && onSave && onDiscard && (
        <InlineSaveDiscard
          hasChanges={!!hasChanges}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}
    </div>
  );
}

function GridItemContent({ item, isModified }: { item: EditableGridItem, isModified?: boolean }) {
  return (
    <>
      <GridLabel icon={item.icon} name={item.name} tooltip={item.tooltip} isModified={isModified} />
      <div className="min-w-0 min-h-8 flex items-center">
        <GridItemValue item={item} />
      </div>
    </>
  );
}
