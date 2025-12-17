"use client";

import { cn } from "@/lib/utils";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { SimpleTooltip } from "@stackframe/stack-ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@stackframe/stack-ui";
import { useState } from "react";
import { EditableInput } from "./editable-input";

// Base item props shared by all types
type BaseItemProps = {
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
};

// Reusable label component
function GridLabel({ icon, name, tooltip }: { icon: React.ReactNode, name: string, tooltip?: string }) {
  const label = (
    <span className="flex gap-2 items-center">
      <span className="opacity-75">{icon}</span>
      <span className="font-semibold whitespace-nowrap mr-2">{name}</span>
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
      <span className="px-1 text-muted-foreground">
        {value ? trueLabel : falseLabel}
      </span>
    );
  }

  return (
    <Select
      value={value ? 'true' : 'false'}
      onValueChange={(v) => runAsynchronously(handleChange(v))}
      disabled={isUpdating}
    >
      <SelectTrigger
        className={cn(
          "w-full px-1 py-0 h-[unset] border-transparent text-foreground font-normal",
          "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800",
          "focus:ring-1 focus:ring-slate-500 dark:focus:ring-gray-50",
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
      <span className="px-1 text-muted-foreground">
        {selectedOption?.label ?? value}
      </span>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => runAsynchronously(handleChange(v))}
      disabled={isUpdating}
    >
      <SelectTrigger
        className={cn(
          "w-full px-1 py-0 h-[unset] border-transparent text-foreground font-normal",
          "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800",
          "focus:ring-1 focus:ring-slate-500 dark:focus:ring-gray-50",
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
        "w-full px-1 py-0 h-[unset] border-transparent rounded text-left text-foreground",
        !disabled && "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50",
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
        "w-full px-1 py-0 h-[unset] border-transparent rounded text-left text-foreground",
        !disabled && "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50",
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

export function EditableGrid({ items, columns = 2, className }: EditableGridProps) {
  const gridCols = columns === 1
    ? "grid-cols-[min-content_1fr]"
    : "grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr]";

  return (
    <div className={cn(
      "grid gap-x-4 gap-y-2 text-sm items-start",
      gridCols,
      className
    )}>
      {items.map((item, index) => (
        <GridItemContent key={index} item={item} />
      ))}
    </div>
  );
}

function GridItemContent({ item }: { item: EditableGridItem }) {
  return (
    <>
      <GridLabel icon={item.icon} name={item.name} tooltip={item.tooltip} />
      <div className="min-w-0">
        <GridItemValue item={item} />
      </div>
    </>
  );
}

