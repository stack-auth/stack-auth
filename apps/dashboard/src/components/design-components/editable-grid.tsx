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
import { useState } from "react";
import { DesignButton } from "./button";
import { useDesignEditMode } from "./edit-mode";
import { DesignInput } from "./input";

export type DesignEditableGridSize = "sm" | "md";

const sizeConfig = {
  sm: { height: "h-7", minHeight: "min-h-7", padding: "px-2", customPl: "pl-2", gapX: "gap-x-1.5", interColPl: "lg:[&>*:nth-child(4n+3)]:pl-3" },
  md: { height: "h-8", minHeight: "min-h-8", padding: "px-3", customPl: "pl-3", gapX: "gap-x-3", interColPl: "lg:[&>*:nth-child(4n+3)]:pl-5" },
} as const;

// Ghost mode: hide visual decorations (bg, border, shadow, ring) by default
const ghostFieldClasses = "bg-transparent dark:bg-transparent border-transparent dark:border-transparent shadow-none ring-0";
// Ghost mode: reveal visual decorations on hover
const ghostFieldHoverClasses = "hover:bg-white/80 dark:hover:bg-foreground/[0.03] hover:border-black/[0.08] dark:hover:border-white/[0.06] hover:shadow-sm hover:ring-1 hover:ring-black/[0.08] dark:hover:ring-white/[0.06]";

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
  size?: DesignEditableGridSize,
  className?: string,
  editMode?: boolean,
  deferredSave?: boolean,
  hasChanges?: boolean,
  onSave?: () => Promise<void>,
  onDiscard?: () => void,
  externalModifiedKeys?: Set<string>,
};

type DesignEditableInputProps = {
  value: string,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  shiftTextToLeft?: boolean,
  mode?: "text" | "password",
};

function DesignEditableInput({
  value,
  onUpdate,
  readOnly,
  placeholder,
  inputClassName,
  shiftTextToLeft,
  mode = "text",
  editMode,
  sz,
}: DesignEditableInputProps & { editMode: boolean, sz: typeof sizeConfig[DesignEditableGridSize] }) {
  return <div className="flex items-center relative w-full">
    <DesignInput
      type={mode === "password" ? "password" : "text"}
      readOnly={readOnly}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      size="sm"
      className={cn(
        "w-full text-sm", sz.height, sz.padding,
        !readOnly && "hover:cursor-pointer",
        !readOnly && "focus:cursor-[unset]",
        readOnly && "focus-visible:ring-0 cursor-default text-muted-foreground",
        shiftTextToLeft && "ml-[-7px]",
        !editMode && ghostFieldClasses,
        !editMode && !readOnly && ghostFieldHoverClasses,
        inputClassName,
      )}
      value={value}
      autoComplete="off"
      style={{ textOverflow: "ellipsis" }}
      onChange={(e) => {
        if (onUpdate) {
          runAsynchronouslyWithAlert(onUpdate(e.target.value));
        }
      }}
    />
  </div>;
}

function GridLabel({
  icon,
  name,
  tooltip,
  isModified,
  sz,
}: {
  icon: React.ReactNode,
  name: string,
  tooltip?: string,
  isModified?: boolean,
  sz: typeof sizeConfig[DesignEditableGridSize],
}) {
  const label = (
    <span className={cn("flex items-center gap-2 text-xs font-semibold text-foreground", sz.height)}>
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-foreground/[0.04] text-muted-foreground">
        {icon}
      </span>
      <span className="whitespace-nowrap">{name}</span>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-amber-500 transition-opacity duration-150", isModified ? "opacity-100" : "opacity-0")} />
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
  editMode,
  sz,
}: {
  value: boolean,
  onUpdate?: (value: boolean) => Promise<void>,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
  editMode: boolean,
  sz: typeof sizeConfig[DesignEditableGridSize],
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
      <span className={cn(
        "flex w-full items-center rounded-xl text-sm text-muted-foreground", sz.height, sz.padding,
        editMode
          ? "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
          : "border border-transparent"
      )}>
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
            "w-full rounded-xl text-sm text-foreground", sz.height, sz.padding,
            "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
            "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
            "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
            "transition-colors duration-150 hover:transition-none",
            "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50",
            isUpdating && "[&_span]:invisible",
            !editMode && ghostFieldClasses,
            !editMode && ghostFieldHoverClasses,
            !editMode && "[&>svg]:opacity-0 hover:[&>svg]:opacity-50",
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
  editMode,
  sz,
}: {
  value: string,
  options: DropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  extraAction?: { label: string, onClick: () => void },
  editMode: boolean,
  sz: typeof sizeConfig[DesignEditableGridSize],
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
      <span className={cn(
        "flex w-full items-center rounded-xl text-sm text-muted-foreground", sz.height, sz.padding,
        editMode
          ? "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
          : "border border-transparent"
      )}>
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
            "w-full rounded-xl text-sm text-foreground", sz.height, sz.padding,
            "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
            "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
            "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06]",
            "transition-colors duration-150 hover:transition-none",
            "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50",
            isUpdating && "[&_span]:invisible",
            !editMode && ghostFieldClasses,
            !editMode && ghostFieldHoverClasses,
            !editMode && "[&>svg]:opacity-0 hover:[&>svg]:opacity-50",
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
  editMode,
  sz,
}: {
  children: React.ReactNode,
  onClick: () => void | Promise<void>,
  disabled?: boolean,
  editMode: boolean,
  sz: typeof sizeConfig[DesignEditableGridSize],
}) {
  return (
    <DesignButton
      variant="outline"
      size="sm"
      className={cn(
        "w-full rounded-xl text-left text-sm text-foreground truncate justify-start", sz.height, sz.padding,
        "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        !disabled && "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] hover:cursor-pointer",
        "transition-colors duration-150 hover:transition-none",
        disabled && "opacity-50 cursor-not-allowed",
        !editMode && ghostFieldClasses,
        !editMode && !disabled && ghostFieldHoverClasses,
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
  editMode,
  sz,
}: {
  triggerContent: React.ReactNode,
  disabled?: boolean,
  editMode: boolean,
  sz: typeof sizeConfig[DesignEditableGridSize],
}) {
  return (
    <button
      disabled={disabled}
      className={cn(
        "w-full rounded-xl text-left text-sm text-foreground truncate", sz.height, sz.padding,
        "bg-white/80 dark:bg-foreground/[0.03] border border-black/[0.08] dark:border-white/[0.06]",
        "shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        !disabled && "hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] hover:cursor-pointer",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
        "transition-colors duration-150 hover:transition-none",
        disabled && "opacity-50 cursor-not-allowed",
        !editMode && ghostFieldClasses,
        !editMode && !disabled && ghostFieldHoverClasses,
      )}
    >
      {triggerContent}
    </button>
  );
}

function GridItemValue({ item, editMode, sz }: { item: DesignEditableGridItem, editMode: boolean, sz: typeof sizeConfig[DesignEditableGridSize] }) {
  switch (item.type) {
    case "text": {
      return (
        <DesignEditableInput
          value={item.value}
          onUpdate={item.onUpdate}
          readOnly={item.readOnly}
          placeholder={item.placeholder}
          editMode={editMode}
          sz={sz}
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
          editMode={editMode}
          sz={sz}
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
          editMode={editMode}
          sz={sz}
        />
      );
    }
    case "custom-dropdown": {
      return (
        <CustomDropdownField
          triggerContent={item.triggerContent}
          disabled={item.disabled}
          editMode={editMode}
          sz={sz}
        />
      );
    }
    case "custom-button": {
      return (
        <CustomButtonField
          onClick={item.onClick}
          disabled={item.disabled}
          editMode={editMode}
          sz={sz}
        >
          {item.children}
        </CustomButtonField>
      );
    }
    case "custom": {
      return <div className={cn("w-full", sz.customPl)}>{item.children}</div>;
    }
  }
}

function GridItemContent({ item, isModified, editMode, sz }: { item: DesignEditableGridItem, isModified?: boolean, editMode: boolean, sz: typeof sizeConfig[DesignEditableGridSize] }) {
  return (
    <>
      <GridLabel icon={item.icon} name={item.name} tooltip={item.tooltip} isModified={isModified} sz={sz} />
      <div className={cn("min-w-0 w-full flex items-center", sz.minHeight)}>
        <GridItemValue item={item} editMode={editMode} sz={sz} />
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
        hasChanges ? "opacity-100 max-h-12 pt-1.5" : "opacity-0 max-h-0 overflow-hidden pt-0"
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
        <span>Discard</span>
      </DesignButton>
      <DesignButton
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="h-8 px-4 text-xs font-medium rounded-lg gap-1.5"
      >
        <FloppyDisk className="h-3 w-3" />
        <span>Save</span>
      </DesignButton>
    </div>
  );
}

export function DesignEditableGrid({
  items,
  columns = 2,
  size = "sm",
  className,
  editMode: editModeProp,
  deferredSave = true,
  hasChanges,
  onSave,
  onDiscard,
  externalModifiedKeys,
}: DesignEditableGridProps) {
  const contextEditMode = useDesignEditMode();
  const editMode = editModeProp ?? contextEditMode;
  const sz = sizeConfig[size];

  const gridCols = columns === 1
    ? "grid-cols-[min-content_1fr]"
    : "grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr]";

  return (
    <div className="space-y-2">
      <div className={cn(
        "grid text-sm items-center",
        editMode ? cn(sz.gapX, "gap-y-3") : cn(sz.gapX, "gap-y-0.5"),
        columns === 2 && sz.interColPl,
        gridCols,
        className
      )}>
        {items.map((item, index) => (
          <GridItemContent
            key={index}
            item={item}
            isModified={item.itemKey ? externalModifiedKeys?.has(item.itemKey) : false}
            editMode={editMode}
            sz={sz}
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
