"use client";

import {
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { DesignButton, useDesignEditMode } from "@hexclave/dashboard-ui-components";
import {
  CaretDown,
  Check,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import { useRef, useState, type HTMLAttributes, type ReactNode } from "react";

export type DesignEditableGridSize = "sm" | "md";

type BaseItemProps = {
  itemKey?: string,
  icon: ReactNode,
  name: string,
  description?: string,
  tooltip?: string,
};

type TextItem = BaseItemProps & {
  type: "text",
  value: string,
  onUpdate?: (value: string) => Promise<void>,
  normalizeInput?: (value: string) => string,
  readOnly?: boolean,
  placeholder?: string,
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"],
};

type BooleanItem = BaseItemProps & {
  type: "boolean",
  value: boolean,
  onUpdate?: (value: boolean) => Promise<void>,
  readOnly?: boolean,
  trueLabel?: string,
  falseLabel?: string,
};

export type DesignEditableGridDropdownOption = {
  value: string,
  label: string,
  disabled?: boolean,
  disabledReason?: string,
};

type DropdownItem = BaseItemProps & {
  type: "dropdown",
  value: string,
  options: DesignEditableGridDropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  extraAction?: {
    label: string,
    onClick: () => void | Promise<void>,
  },
};

type CustomDropdownItem = BaseItemProps & {
  type: "custom-dropdown",
  triggerContent: ReactNode,
  popoverContent: ReactNode,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  disabled?: boolean,
};

type CustomButtonItem = BaseItemProps & {
  type: "custom-button",
  children: ReactNode,
  onClick: () => void | Promise<void>,
  disabled?: boolean,
};

type CustomContentItem = BaseItemProps & {
  type: "custom",
  children: ReactNode,
};

export type DesignEditableGridItem =
  | TextItem
  | BooleanItem
  | DropdownItem
  | CustomDropdownItem
  | CustomButtonItem
  | CustomContentItem;

export type DesignEditableGridProps = {
  items: DesignEditableGridItem[],
  columns?: 1 | 2,
  size?: DesignEditableGridSize,
  className?: string,
  editMode?: boolean,
  deferredSave?: boolean,
  hasChanges?: boolean,
  onSave?: () => Promise<void>,
  onDiscard?: () => void,
  externalModifiedKeys?: ReadonlySet<string>,
  "aria-label"?: string,
};

type FieldSizeConfig = {
  control: "sm" | "md",
  controlHeight: string,
  controlPadding: string,
  controlText: string,
  labelHeight: string,
  iconSize: string,
  gapX: string,
  gapY: string,
};

const sizeConfig = new Map<DesignEditableGridSize, FieldSizeConfig>([
  ["sm", {
    control: "sm",
    controlHeight: "h-8",
    controlPadding: "px-2.5",
    controlText: "text-sm",
    labelHeight: "min-h-8",
    iconSize: "h-6 w-6",
    gapX: "gap-x-3",
    gapY: "gap-y-3",
  }],
  ["md", {
    control: "md",
    controlHeight: "h-9",
    controlPadding: "px-3",
    controlText: "text-sm",
    labelHeight: "min-h-9",
    iconSize: "h-7 w-7",
    gapX: "gap-x-4",
    gapY: "gap-y-4",
  }],
]);

/**
 * Shared editable control surface for DesignEditableGrid and page-local
 * custom triggers that sit inside a grid value cell. White / neutral only —
 * never tinted theme backgrounds that read as purple on glass pages.
 */
export const designEditableGridControlClassName = cn(
  "rounded-lg border border-black/[0.1] bg-white text-foreground shadow-none",
  "hover:bg-zinc-50 hover:border-black/[0.16]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/[0.12]",
  "dark:border-white/[0.1] dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:hover:border-white/[0.18]",
  "dark:focus-visible:ring-white/[0.16]",
  "transition-colors duration-150 hover:transition-none",
);

export const designEditableGridPopoverClassName = cn(
  "w-64 rounded-xl border border-black/[0.1] bg-white p-3 shadow-lg",
  "dark:border-white/[0.1] dark:bg-zinc-950",
);

function getSizeConfig(size: DesignEditableGridSize) {
  const config = sizeConfig.get(size);
  if (config == null) {
    throw new Error(`DesignEditableGrid does not define styles for size "${size}".`);
  }
  return config;
}

function ReadOnlyValue({
  children,
  placeholder,
}: {
  children: ReactNode,
  placeholder?: string,
}) {
  const hasValue = children !== "";

  return (
    <span className={cn(
      "block min-w-0 truncate text-sm",
      hasValue ? "text-foreground" : "text-muted-foreground/70",
    )}>
      {hasValue ? children : (placeholder ?? "—")}
    </span>
  );
}

function EditableTextField({
  item,
  editMode,
  size,
}: {
  item: TextItem,
  editMode: boolean,
  size: FieldSizeConfig,
}) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(item.value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = item.readOnly !== true && item.onUpdate != null;

  const beginEditing = () => {
    if (!canEdit) {
      return;
    }
    setDraftValue(item.value);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraftValue(item.value);
    setEditing(false);
  };

  const save = async () => {
    if (item.onUpdate == null) {
      throw new Error(`Editable text item "${item.name}" requires an onUpdate handler.`);
    }

    setIsSaving(true);
    try {
      await item.onUpdate(draftValue);
      setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!canEdit && !editing) {
    return (
      <div className={cn("flex w-full items-center", size.controlHeight, size.controlPadding)}>
        <ReadOnlyValue placeholder={item.placeholder}>{item.value}</ReadOnlyValue>
      </div>
    );
  }

  // Idle and edit share the same shell so height/width/radius never jump —
  // only the border weight and trailing actions change.
  return (
    <div
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      aria-label={editing ? undefined : `Edit ${item.name}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1",
        size.controlHeight,
        size.controlPadding,
        designEditableGridControlClassName,
        editing
          ? "border-black/[0.28] dark:border-white/[0.32]"
          : editMode && "border-black/[0.18] dark:border-white/[0.22]",
        !editing && "cursor-text",
      )}
      onClick={() => {
        if (!editing) {
          beginEditing();
        } else {
          inputRef.current?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (editing) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          beginEditing();
        }
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          aria-label={item.name}
          autoComplete="off"
          disabled={isSaving}
          inputMode={item.inputMode}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraftValue(item.normalizeInput?.(nextValue) ?? nextValue);
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (draftValue !== item.value && !isSaving) {
                runAsynchronouslyWithAlert(save());
              }
            }
            if (event.key === "Escape") {
              cancelEditing();
            }
          }}
          placeholder={item.placeholder}
          value={draftValue}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none",
            "placeholder:text-muted-foreground/70",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      ) : (
        <span className="min-w-0 flex-1">
          <ReadOnlyValue placeholder={item.placeholder}>{item.value}</ReadOnlyValue>
        </span>
      )}
      {editing ? (
        <div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          <DesignButton
            aria-label={`Save ${item.name}`}
            className="h-6 w-6 rounded-md p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            disabled={draftValue === item.value || isSaving}
            loading={isSaving}
            onClick={save}
            size="icon"
            variant="ghost"
          >
            <Check aria-hidden className="h-3.5 w-3.5" weight="bold" />
          </DesignButton>
          <DesignButton
            aria-label={`Cancel editing ${item.name}`}
            className="h-6 w-6 rounded-md p-0 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            disabled={isSaving}
            onClick={cancelEditing}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden className="h-3.5 w-3.5" weight="bold" />
          </DesignButton>
        </div>
      ) : (
        <PencilSimple
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      )}
    </div>
  );
}

function EditableBooleanField({
  item,
  editMode,
  size,
}: {
  item: BooleanItem,
  editMode: boolean,
  size: FieldSizeConfig,
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const canEdit = item.readOnly !== true && item.onUpdate != null;
  const trueLabel = item.trueLabel ?? "Yes";
  const falseLabel = item.falseLabel ?? "No";
  const statusLabel = item.value ? trueLabel : falseLabel;

  if (!canEdit) {
    return (
      <div className={cn("flex w-full items-center", size.controlHeight, size.controlPadding)}>
        <ReadOnlyValue>{statusLabel}</ReadOnlyValue>
      </div>
    );
  }

  const updateValue = async (nextValue: boolean) => {
    if (item.onUpdate == null) {
      throw new Error(`Editable boolean item "${item.name}" requires an onUpdate handler.`);
    }
    setIsUpdating(true);
    try {
      await item.onUpdate(nextValue);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <label
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5",
        size.controlHeight,
        size.controlPadding,
        designEditableGridControlClassName,
        editMode && "border-black/[0.18] dark:border-white/[0.22]",
        isUpdating && "opacity-70",
      )}
    >
      <Checkbox
        aria-label={item.name}
        checked={item.value}
        disabled={isUpdating}
        onCheckedChange={(checked) => {
          if (checked === "indeterminate") {
            return;
          }
          runAsynchronouslyWithAlert(updateValue(checked));
        }}
        className="border-black/[0.2] shadow-none data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background dark:border-white/[0.25] dark:data-[state=checked]:border-white dark:data-[state=checked]:bg-white dark:data-[state=checked]:text-zinc-950"
      />
      <span className={cn("min-w-0 truncate", size.controlText, "text-foreground")}>
        {statusLabel}
      </span>
    </label>
  );
}

function AsyncSelectField({
  value,
  options,
  onUpdate,
  readOnly,
  placeholder,
  name,
  editMode,
  size,
  extraAction,
}: {
  value: string,
  options: DesignEditableGridDropdownOption[],
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  name: string,
  editMode: boolean,
  size: FieldSizeConfig,
  extraAction?: DropdownItem["extraAction"],
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const canEdit = readOnly !== true && onUpdate != null;

  if (!canEdit) {
    return (
      <div className={cn("flex w-full items-center", size.controlHeight, size.controlPadding)}>
        <ReadOnlyValue placeholder={placeholder}>{selectedOption?.label ?? value}</ReadOnlyValue>
      </div>
    );
  }

  const updateValue = async (nextValue: string) => {
    setIsUpdating(true);
    try {
      await onUpdate(nextValue);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="relative w-full">
      <Select
        disabled={isUpdating}
        onValueChange={(nextValue) => runAsynchronouslyWithAlert(updateValue(nextValue))}
        value={value}
      >
        <SelectTrigger
          aria-label={name}
          className={cn(
            "w-full shadow-none ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-50",
            size.controlHeight,
            size.controlPadding,
            size.controlText,
            designEditableGridControlClassName,
            editMode && "border-black/[0.18] dark:border-white/[0.22]",
            isUpdating && "[&>span]:opacity-0",
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-zinc-950 border-black/[0.1] dark:border-white/[0.1]">
          {options.map((option) => {
            const optionContent = (
              <SelectItem
                className={option.disabled ? "opacity-50" : undefined}
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            );

            if (option.disabled && option.disabledReason != null) {
              return (
                <SimpleTooltip key={option.value} tooltip={option.disabledReason}>
                  <div>{optionContent}</div>
                </SimpleTooltip>
              );
            }
            return optionContent;
          })}
          {extraAction != null && (
            <>
              <div className="my-1 h-px bg-black/[0.08] dark:bg-white/[0.1]" />
              <DesignButton
                className="h-8 w-full justify-start rounded-md px-2 text-xs"
                onClick={extraAction.onClick}
                size="sm"
                variant="ghost"
              >
                {extraAction.label}
              </DesignButton>
            </>
          )}
        </SelectContent>
      </Select>
      {isUpdating && (
        <Spinner
          aria-label={`Updating ${name}`}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          size={14}
        />
      )}
    </div>
  );
}

function CustomDropdownField({
  item,
  editMode,
  size,
}: {
  item: CustomDropdownItem,
  editMode: boolean,
  size: FieldSizeConfig,
}) {
  return (
    <Popover open={item.open} onOpenChange={item.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={item.name}
          disabled={item.disabled}
          className={cn(
            "flex w-full items-center justify-between gap-2 text-left font-normal",
            size.controlHeight,
            size.controlPadding,
            size.controlText,
            designEditableGridControlClassName,
            editMode && "border-black/[0.18] dark:border-white/[0.22]",
            item.disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="min-w-0 truncate">{item.triggerContent}</span>
          <CaretDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={designEditableGridPopoverClassName}>
        {item.popoverContent}
      </PopoverContent>
    </Popover>
  );
}

function ItemValue({
  item,
  editMode,
  size,
}: {
  item: DesignEditableGridItem,
  editMode: boolean,
  size: FieldSizeConfig,
}) {
  switch (item.type) {
    case "text": {
      return <EditableTextField editMode={editMode} item={item} size={size} />;
    }
    case "boolean": {
      return <EditableBooleanField editMode={editMode} item={item} size={size} />;
    }
    case "dropdown": {
      return (
        <AsyncSelectField
          editMode={editMode}
          extraAction={item.extraAction}
          name={item.name}
          onUpdate={item.onUpdate}
          options={item.options}
          placeholder={item.placeholder}
          readOnly={item.readOnly}
          size={size}
          value={item.value}
        />
      );
    }
    case "custom-dropdown": {
      return <CustomDropdownField editMode={editMode} item={item} size={size} />;
    }
    case "custom-button": {
      return (
        <DesignButton
          variant="plain"
          disabled={item.disabled}
          onClick={() => item.onClick()}
          className={cn(
            "flex w-full items-center justify-start gap-2 text-left font-normal",
            size.controlHeight,
            size.controlPadding,
            size.controlText,
            designEditableGridControlClassName,
            editMode && "border-black/[0.18] dark:border-white/[0.22]",
          )}
        >
          <span className="min-w-0 truncate">{item.children}</span>
        </DesignButton>
      );
    }
    case "custom": {
      return <div className="min-w-0 w-full text-sm text-foreground">{item.children}</div>;
    }
  }
}

function ItemLabel({
  item,
  isModified,
  size,
}: {
  item: DesignEditableGridItem,
  isModified: boolean,
  size: FieldSizeConfig,
}) {
  const label = (
    <div className={cn("flex min-w-0 items-center gap-2", size.labelHeight)}>
      <span className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-zinc-100 text-muted-foreground",
        "dark:bg-zinc-900",
        size.iconSize,
      )}>
        {item.icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{item.name}</span>
          {isModified && (
            <span
              aria-label="Modified"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            />
          )}
        </span>
        {item.description != null && (
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {item.description}
          </span>
        )}
      </span>
    </div>
  );

  if (item.tooltip == null) {
    return label;
  }

  return <SimpleTooltip tooltip={item.tooltip}>{label}</SimpleTooltip>;
}

function SaveBar({
  onDiscard,
  onSave,
}: {
  onDiscard: () => void,
  onSave: () => Promise<void>,
}) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/20 dark:bg-amber-500/[0.08]"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Unsaved changes
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <DesignButton
          className="h-8 rounded-lg px-3 text-xs text-muted-foreground"
          disabled={isSaving}
          onClick={onDiscard}
          size="sm"
          variant="ghost"
        >
          Discard
        </DesignButton>
        <DesignButton
          className="h-8 rounded-lg px-3 text-xs"
          loading={isSaving}
          onClick={handleSave}
          size="sm"
        >
          Save changes
        </DesignButton>
      </div>
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
  hasChanges = false,
  onSave,
  onDiscard,
  externalModifiedKeys,
  "aria-label": ariaLabel = "Editable settings",
}: DesignEditableGridProps) {
  const contextEditMode = useDesignEditMode();
  const editMode = editModeProp ?? contextEditMode;
  const resolvedSize = getSizeConfig(size);

  if ((onSave == null) !== (onDiscard == null)) {
    throw new Error("DesignEditableGrid requires both onSave and onDiscard when either callback is provided.");
  }
  if (deferredSave && hasChanges && (onSave == null || onDiscard == null)) {
    throw new Error("DesignEditableGrid cannot display pending changes without onSave and onDiscard callbacks.");
  }

  const gridCols = columns === 1
    ? "grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)]"
    : "grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)] lg:grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)_minmax(7.5rem,max-content)_minmax(0,1fr)]";

  return (
    <div aria-label={ariaLabel} className="space-y-3" role="group">
      <div
        className={cn(
          "grid items-center text-sm",
          resolvedSize.gapX,
          resolvedSize.gapY,
          columns === 2 && "lg:[&>div:nth-child(even)>:first-child]:pl-4",
          gridCols,
          className,
        )}
      >
        {items.map((item, index) => {
          const isModified = item.itemKey != null && externalModifiedKeys?.has(item.itemKey) === true;
          const key = item.itemKey ?? `${item.type}-${item.name}-${index}`;
          return (
            <div key={key} className="contents">
              <ItemLabel isModified={isModified} item={item} size={resolvedSize} />
              <div className="min-w-0 w-full">
                <ItemValue editMode={editMode} item={item} size={resolvedSize} />
              </div>
            </div>
          );
        })}
      </div>
      {deferredSave && hasChanges && onSave != null && onDiscard != null && (
        <SaveBar onDiscard={onDiscard} onSave={onSave} />
      )}
    </div>
  );
}
