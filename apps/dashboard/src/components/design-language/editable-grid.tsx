"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { DesignButton } from "./button";
import { DesignInput } from "./input";

type BaseItemProps = {
  itemKey?: string,
  icon: React.ReactNode,
  name: string,
  tooltip?: string,
};

type TextItem = BaseItemProps & {
  type: "text",
  value: string,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
};

type BooleanItem = BaseItemProps & {
  type: "boolean",
  value: boolean,
  onUpdate?: (value: boolean) => Promise<void>,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
};

type DropdownOption = {
  value: string,
  label: string,
  disabled?: boolean,
  disabledReason?: string,
};

type DropdownItem = BaseItemProps & {
  type: "dropdown",
  value: string,
  options: DropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  extraAction?: {
    label: string,
    onClick: () => void,
  },
};

type CustomDropdownItem = BaseItemProps & {
  type: "custom-dropdown",
  triggerContent: React.ReactNode,
  popoverContent: React.ReactNode,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  disabled?: boolean,
};

type CustomButtonItem = BaseItemProps & {
  type: "custom-button",
  children: React.ReactNode,
  onClick: () => void,
  disabled?: boolean,
};

type CustomContentItem = BaseItemProps & {
  type: "custom",
  children: React.ReactNode,
};

export type DesignEditableGridItem =
  | TextItem
  | BooleanItem
  | DropdownItem
  | CustomDropdownItem
  | CustomButtonItem
  | CustomContentItem;

type DesignEditableGridProps = {
  items: DesignEditableGridItem[],
  columns?: 1 | 2,
  className?: string,
  deferredSave?: boolean,
  hasChanges?: boolean,
  onSave?: () => Promise<void>,
  onDiscard?: () => void,
  externalModifiedKeys?: Set<string>,
};

type DesignEditableInputProps = {
  value: string,
  initialEditValue?: string | undefined,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  shiftTextToLeft?: boolean,
  mode?: "text" | "password",
};

function DesignEditableInput({
  value,
  initialEditValue,
  onUpdate,
  readOnly,
  placeholder,
  inputClassName,
  shiftTextToLeft,
  mode = "text",
}: DesignEditableInputProps) {
  const [editValue, setEditValue] = useState(initialEditValue ?? value);
  const saveDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedValueRef = useRef(value);
  const isPersistingRef = useRef(false);
  const queuedPersistValueRef = useRef<string | null>(null);

  useEffect(() => {
    setEditValue(value);
    lastPersistedValueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (saveDebounceTimeoutRef.current) {
        clearTimeout(saveDebounceTimeoutRef.current);
      }
    };
  }, []);

  const persistValue = (nextValue: string) => {
    if (!onUpdate || readOnly) return;
    if (nextValue === lastPersistedValueRef.current) return;

    if (isPersistingRef.current) {
      queuedPersistValueRef.current = nextValue;
      return;
    }

    isPersistingRef.current = true;
    runAsynchronouslyWithAlert(
      Promise.resolve(onUpdate(nextValue)).finally(() => {
        lastPersistedValueRef.current = nextValue;
        isPersistingRef.current = false;
        const queuedValue = queuedPersistValueRef.current;
        queuedPersistValueRef.current = null;
        if (queuedValue !== null && queuedValue !== lastPersistedValueRef.current) {
          persistValue(queuedValue);
        }
      })
    );
  };

  const schedulePersist = (nextValue: string) => {
    if (saveDebounceTimeoutRef.current) {
      clearTimeout(saveDebounceTimeoutRef.current);
    }
    saveDebounceTimeoutRef.current = setTimeout(() => {
      persistValue(nextValue);
    }, 350);
  };

  return <div className="flex items-center relative w-full">
    <DesignInput
      type={mode === "password" ? "password" : "text"}
      readOnly={readOnly}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      size="sm"
      className={cn(
        "w-full px-3 h-8 text-sm",
        !readOnly && "hover:cursor-pointer",
        !readOnly && "focus:cursor-[unset]",
        readOnly && "focus-visible:ring-0 cursor-default text-muted-foreground",
        shiftTextToLeft && "ml-[-7px]",
        inputClassName,
      )}
      value={editValue}
      autoComplete="off"
      style={{ textOverflow: "ellipsis" }}
      onChange={(e) => {
        const nextValue = e.target.value;
        setEditValue(nextValue);
        schedulePersist(nextValue);
      }}
      onBlur={() => {
        if (saveDebounceTimeoutRef.current) {
          clearTimeout(saveDebounceTimeoutRef.current);
        }
        persistValue(editValue);
      }}
    />
  </div>;
}

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

function EditableBooleanField({
  value,
  onUpdate,
  readOnly,
  trueLabel = "Yes",
  falseLabel = "No",
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
      await onUpdate(newValue === "true");
    } finally {
      setIsUpdating(false);
    }
  };

  if (readOnly) {
    return (
      <span className="flex h-8 w-full items-center rounded-xl bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] px-3 text-sm text-muted-foreground shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]">
        {value ? trueLabel : falseLabel}
      </span>
    );
  }

  return (
    <div className="relative w-full">
      <Select
        value={value ? "true" : "false"}
        onValueChange={(nextValue) => runAsynchronouslyWithAlert(handleChange(nextValue))}
        disabled={isUpdating}
      >
        <SelectTrigger
          className={cn(
            "h-8 w-full rounded-xl px-3 text-sm text-foreground",
            "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
            "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
            "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
            "transition-colors duration-150 hover:transition-none",
            "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50",
            isUpdating && "[&_span]:invisible"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{trueLabel}</SelectItem>
          <SelectItem value="false">{falseLabel}</SelectItem>
        </SelectContent>
      </Select>
      {isUpdating && (
        <Spinner
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        />
      )}
    </div>
  );
}

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

  const selectedOption = options.find(option => option.value === value);

  if (readOnly) {
    return (
      <span className="flex h-8 w-full items-center rounded-xl bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] px-3 text-sm text-muted-foreground shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]">
        {selectedOption?.label ?? value}
      </span>
    );
  }

  return (
    <div className="relative w-full">
      <Select
        value={value}
        onValueChange={(nextValue) => runAsynchronouslyWithAlert(handleChange(nextValue))}
        disabled={isUpdating}
      >
        <SelectTrigger
          className={cn(
            "h-8 w-full rounded-xl px-3 text-sm text-foreground",
            "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
            "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
            "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
            "transition-colors duration-150 hover:transition-none",
            "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50",
            isUpdating && "[&_span]:invisible"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            const optionItem = (
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
                  <div>{optionItem}</div>
                </SimpleTooltip>
              );
            }
            return optionItem;
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
      {isUpdating && (
        <Spinner
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        />
      )}
    </div>
  );
}

function CustomButtonField({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode,
  onClick: () => void | Promise<void>,
  disabled?: boolean,
}) {
  return (
    <DesignButton
      variant="outline"
      size="sm"
      className={cn(
        "h-8 w-full rounded-xl px-3 text-left text-sm text-foreground truncate justify-start",
        "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        !disabled && "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] hover:cursor-pointer",
        "transition-colors duration-150 hover:transition-none",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </DesignButton>
  );
}

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
        "h-8 w-full rounded-xl px-3 text-left text-sm text-foreground truncate",
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

function GridItemValue({ item }: { item: DesignEditableGridItem }) {
  switch (item.type) {
    case "text": {
      return (
        <DesignEditableInput
          value={item.value}
          onUpdate={item.onUpdate}
          readOnly={item.readOnly}
          placeholder={item.placeholder}
        />
      );
    }
    case "boolean": {
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
    case "dropdown": {
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
    case "custom-dropdown": {
      return (
        <CustomDropdownField
          triggerContent={item.triggerContent}
          disabled={item.disabled}
        />
      );
    }
    case "custom-button": {
      return (
        <CustomButtonField
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {item.children}
        </CustomButtonField>
      );
    }
    case "custom": {
      return <>{item.children}</>;
    }
  }
}

function GridItemContent({ item, isModified }: { item: DesignEditableGridItem, isModified?: boolean }) {
  return (
    <>
      <GridLabel icon={item.icon} name={item.name} tooltip={item.tooltip} isModified={isModified} />
      <div className="min-w-0 min-h-8 w-full flex items-center">
        <GridItemValue item={item} />
      </div>
    </>
  );
}

function DesignInlineSaveDiscard({
  hasChanges,
  onSave,
  onDiscard,
}: {
  hasChanges: boolean,
  onSave: () => Promise<void>,
  onDiscard: () => void,
}) {
  const [handleSave, isSaving] = useAsyncCallback(onSave, [onSave]);

  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 transition-all duration-200 ease-out",
        hasChanges ? "opacity-100 max-h-12 pt-3" : "opacity-0 max-h-0 overflow-hidden pt-0"
      )}
    >
      <DesignButton
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        disabled={isSaving}
        className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg transition-colors duration-150 hover:transition-none gap-1.5"
      >
        <ArrowCounterClockwise className="h-3 w-3" />
        Discard
      </DesignButton>
      <DesignButton
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="h-8 px-4 text-xs font-medium rounded-lg gap-1.5"
      >
        <FloppyDisk className="h-3 w-3" />
        Save
      </DesignButton>
    </div>
  );
}

export function DesignEditableGrid({
  items,
  columns = 2,
  className,
  deferredSave,
  hasChanges,
  onSave,
  onDiscard,
  externalModifiedKeys,
}: DesignEditableGridProps) {
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
        <DesignInlineSaveDiscard
          hasChanges={!!hasChanges}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}
    </div>
  );
}
