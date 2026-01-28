"use client";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// Base item props shared by all types
type BaseItemProps = {
  icon: React.ReactNode,
  name: string,
  tooltip?: string,
  /**
   * Unique key for this item. Required when using deferred save mode to track changes.
   */
  itemKey?: string,
};

// Text input item
type TextItem = BaseItemProps & {
  type: 'text',
  value: string,
  onChange?: (value: string) => void,
  readOnly?: boolean,
  placeholder?: string,
};

// Boolean dropdown item (Yes/No)
type BooleanItem = BaseItemProps & {
  type: 'boolean',
  value: boolean,
  onChange?: (value: boolean) => void,
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
  onChange?: (value: string) => void,
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

// Context for tracking modifications in deferred save mode
type EditableGridContextType = {
  modifiedKeys: Set<string>,
  markModified: (key: string) => void,
};

const EditableGridContext = createContext<EditableGridContextType | null>(null);

function useEditableGridContext() {
  return useContext(EditableGridContext);
}

type EditableGridProps = {
  items: EditableGridItem[],
  columns?: 1 | 2,
  className?: string,
  /**
   * If true, shows Save/Discard buttons at the bottom when there are unsaved changes.
   * All item changes are deferred until Save is clicked.
   */
  deferredSave?: boolean,
  /**
   * Whether there are unsaved changes. Required when deferredSave is true.
   */
  hasChanges?: boolean,
  /**
   * Called when Save is clicked. Should apply the pending changes.
   */
  onSave?: () => Promise<void>,
  /**
   * Called when Discard is clicked. Should reset to original values.
   */
  onDiscard?: () => void,
  /**
   * Set of itemKeys that are modified (for custom items where the parent tracks changes).
   * These are merged with internally tracked modifications.
   */
  externalModifiedKeys?: Set<string>,
};

// Reusable label component
function GridLabel({ icon, name, tooltip, isModified }: { icon: React.ReactNode, name: string, tooltip?: string, isModified?: boolean }) {
  const label = (
    <span className={cn(
      "flex gap-2 items-center transition-colors duration-150",
      isModified && "text-amber-600 dark:text-amber-400"
    )}>
      <span className="opacity-75">{icon}</span>
      <span className="font-semibold whitespace-nowrap mr-2">{name}</span>
      {isModified && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
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

// Inline editable input for EditableGrid (without OK/X buttons in deferred mode)
function GridEditableInput({
  value,
  onChange,
  readOnly,
  placeholder,
  itemKey,
}: {
  value: string,
  onChange?: (value: string) => void,
  readOnly?: boolean,
  placeholder?: string,
  itemKey?: string,
}) {
  const ctx = useEditableGridContext();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value);
    if (itemKey && ctx) {
      ctx.markModified(itemKey);
    }
  }, [onChange, itemKey, ctx]);

  return (
    <input
      ref={inputRef}
      type="text"
      readOnly={readOnly}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      className={cn(
        "w-full px-1 py-0.5 border-transparent rounded bg-transparent text-foreground text-sm",
        !readOnly && "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800",
        !readOnly && "focus:outline-none focus:ring-1 focus:ring-slate-500 dark:focus:ring-gray-50 focus:bg-slate-100 dark:focus:bg-gray-800",
        readOnly && "cursor-default text-muted-foreground",
        "transition-colors duration-150 hover:transition-none"
      )}
      value={value}
      onChange={handleChange}
    />
  );
}

// Editable boolean dropdown component
function EditableBooleanField({
  value,
  onChange,
  readOnly,
  trueLabel = 'Yes',
  falseLabel = 'No',
  itemKey,
}: {
  value: boolean,
  onChange?: (value: boolean) => void,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
  itemKey?: string,
}) {
  const ctx = useEditableGridContext();

  const handleChange = useCallback((newValue: string) => {
    const boolValue = newValue === 'true';
    onChange?.(boolValue);
    if (itemKey && ctx) {
      ctx.markModified(itemKey);
    }
  }, [onChange, itemKey, ctx]);

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
      onValueChange={handleChange}
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
  onChange,
  readOnly,
  extraAction,
  itemKey,
}: {
  value: string,
  options: DropdownOption[],
  onChange?: (value: string) => void,
  readOnly?: boolean,
  extraAction?: { label: string, onClick: () => void },
  itemKey?: string,
}) {
  const ctx = useEditableGridContext();

  const handleChange = useCallback((newValue: string) => {
    onChange?.(newValue);
    if (itemKey && ctx) {
      ctx.markModified(itemKey);
    }
  }, [onChange, itemKey, ctx]);

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
      onValueChange={handleChange}
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
        <GridEditableInput
          value={item.value}
          onChange={item.onChange}
          readOnly={item.readOnly}
          placeholder={item.placeholder}
          itemKey={item.itemKey}
        />
      );
    }

    case 'boolean': {
      return (
        <EditableBooleanField
          value={item.value}
          onChange={item.onChange}
          readOnly={item.readOnly}
          trueLabel={item.trueLabel}
          falseLabel={item.falseLabel}
          itemKey={item.itemKey}
        />
      );
    }

    case 'dropdown': {
      return (
        <EditableDropdownField
          value={item.value}
          options={item.options}
          onChange={item.onChange}
          readOnly={item.readOnly}
          extraAction={item.extraAction}
          itemKey={item.itemKey}
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

// Save/Discard footer component
function SaveDiscardFooter({
  hasChanges,
  onSave,
  onDiscard,
}: {
  hasChanges: boolean,
  onSave: () => Promise<void>,
  onDiscard: () => void,
}) {
  const [handleSave, isSaving] = useAsyncCallback(async () => {
    await onSave();
  }, [onSave]);

  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border/40",
        "transition-all duration-200 ease-out",
        hasChanges ? "opacity-100 max-h-16" : "opacity-0 max-h-0 overflow-hidden pt-0 mt-0 border-t-0"
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        disabled={isSaving}
        className="text-xs h-7 px-2"
      >
        <XIcon className="h-3 w-3 mr-1" />
        Discard
      </Button>
      <Button
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="text-xs h-7 px-3"
      >
        <CheckIcon className="h-3 w-3 mr-1" />
        Save changes
      </Button>
    </div>
  );
}

export function EditableGrid({
  items,
  columns = 2,
  className,
  deferredSave = false,
  hasChanges = false,
  onSave,
  onDiscard,
  externalModifiedKeys,
}: EditableGridProps) {
  const [modifiedKeys, setModifiedKeys] = useState<Set<string>>(new Set());

  const markModified = useCallback((key: string) => {
    setModifiedKeys(prev => new Set(prev).add(key));
  }, []);

  const contextValue = useMemo(() => ({
    modifiedKeys,
    markModified,
  }), [modifiedKeys, markModified]);

  const handleDiscard = useCallback(() => {
    setModifiedKeys(new Set());
    onDiscard?.();
  }, [onDiscard]);

  const handleSave = useCallback(async () => {
    await onSave?.();
    setModifiedKeys(new Set());
  }, [onSave]);

  // Check if an itemKey is modified (internal or external)
  const isItemModified = useCallback((itemKey: string | undefined) => {
    if (!deferredSave || !itemKey) return false;
    return modifiedKeys.has(itemKey) || (externalModifiedKeys?.has(itemKey) ?? false);
  }, [deferredSave, modifiedKeys, externalModifiedKeys]);

  const gridCols = columns === 1
    ? "grid-cols-[min-content_1fr]"
    : "grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr]";

  const content = (
    <div className={cn(
      "grid gap-x-4 gap-y-2 text-sm items-start",
      gridCols,
      className
    )}>
      {items.map((item, index) => (
        <GridItemContent
          key={item.itemKey ?? index}
          item={item}
          isModified={isItemModified(item.itemKey)}
        />
      ))}
    </div>
  );

  if (deferredSave) {
    return (
      <EditableGridContext.Provider value={contextValue}>
        <div>
          {content}
          <SaveDiscardFooter
            hasChanges={hasChanges}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        </div>
      </EditableGridContext.Provider>
    );
  }

  return content;
}

function GridItemContent({ item, isModified }: { item: EditableGridItem, isModified?: boolean }) {
  return (
    <>
      <GridLabel icon={item.icon} name={item.name} tooltip={item.tooltip} isModified={isModified} />
      <div className="min-w-0">
        <GridItemValue item={item} />
      </div>
    </>
  );
}
