"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DotsThree } from "@phosphor-icons/react";
import { DesignButton } from "@stackframe/dashboard-ui-components";

type DesignMenuTrigger = "button" | "icon";
type DesignMenuItemVariant = "default" | "destructive";
type DesignMenuAlign = "start" | "center" | "end";

export type DesignMenuActionItem = {
  id: string,
  label: string,
  icon?: React.ReactNode,
  itemVariant?: DesignMenuItemVariant,
  onClick?: () => void | Promise<void>,
};

export type DesignMenuSelectorOption = {
  id: string,
  label: string,
};

export type DesignMenuToggleOption = {
  id: string,
  label: string,
  checked: boolean,
};

type DesignMenuBaseProps = {
  trigger?: DesignMenuTrigger,
  triggerLabel?: string,
  triggerIcon?: React.ReactNode,
  label?: string,
  withIcons?: boolean,
  align?: DesignMenuAlign,
  contentClassName?: string,
};

type DesignMenuActionsProps = DesignMenuBaseProps & {
  variant: "actions",
  items: DesignMenuActionItem[],
};

type DesignMenuSelectorProps = DesignMenuBaseProps & {
  variant: "selector",
  options: DesignMenuSelectorOption[],
  value: string,
  onValueChange: (value: string) => void,
};

type DesignMenuTogglesProps = DesignMenuBaseProps & {
  variant: "toggles",
  options: DesignMenuToggleOption[],
  onToggleChange: (id: string, checked: boolean) => void,
};

export type DesignMenuProps =
  | DesignMenuActionsProps
  | DesignMenuSelectorProps
  | DesignMenuTogglesProps;

const destructiveItemClasses = "text-red-600 dark:text-red-400 focus:bg-red-500/10";

export function DesignMenu(props: DesignMenuProps) {
  const align = props.align ?? (props.variant === "toggles" ? "end" : "start");
  const triggerLabel = props.triggerLabel ?? "Open Menu";
  const trigger = props.trigger ?? "button";
  const triggerIcon = props.triggerIcon ?? <DotsThree size={18} weight="bold" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === "button" ? (
          <DesignButton variant="outline" size="sm" className="h-8 px-3 rounded-lg">
            {triggerLabel}
          </DesignButton>
        ) : (
          <DesignButton
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
            aria-label={triggerLabel}
          >
            {triggerIcon}
          </DesignButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn("min-w-[200px]", props.contentClassName)}
      >
        {props.label && (
          <>
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {props.label}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {props.variant === "actions" && props.items.map((item) => {
          const itemIcon = props.withIcons ? item.icon : undefined;
          const itemClasses = item.itemVariant === "destructive" ? destructiveItemClasses : undefined;

          return (
            <DropdownMenuItem
              key={item.id}
              icon={itemIcon}
              onClick={item.onClick}
              className={itemClasses}
            >
              {item.label}
            </DropdownMenuItem>
          );
        })}

        {props.variant === "selector" && (
          <DropdownMenuRadioGroup
            value={props.value}
            onValueChange={props.onValueChange}
          >
            {props.options.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}

        {props.variant === "toggles" && props.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={option.checked}
            onCheckedChange={(checked) => props.onToggleChange(option.id, !!checked)}
            onSelect={(e) => e.preventDefault()}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
