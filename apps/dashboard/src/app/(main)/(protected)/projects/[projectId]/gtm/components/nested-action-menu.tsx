"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DotsThree } from "@phosphor-icons/react";
import { DesignButton } from "@hexclave/dashboard-ui-components";

// GTM-local menu. This mirrors the shape of the shared DesignMenu "actions" variant, but adds
// support for nested submenus (via `items`) that the shared component intentionally doesn't have.
// It lives inside the GTM feature so we can iterate on the admin "Add record" flow without
// touching the global design component or its existing behaviour/UI.

type GtmActionMenuItemVariant = "default" | "destructive";
type GtmActionMenuTrigger = "button" | "icon";
type GtmActionMenuAlign = "start" | "center" | "end";

export type GtmActionMenuItem = {
  id: string,
  label: string,
  icon?: React.ReactNode,
  itemVariant?: GtmActionMenuItemVariant,
  onClick?: () => void | Promise<void>,
  items?: GtmActionMenuItem[],
};

export type GtmActionMenuProps = {
  items: GtmActionMenuItem[],
  trigger?: GtmActionMenuTrigger,
  triggerLabel?: string,
  triggerIcon?: React.ReactNode,
  label?: string,
  withIcons?: boolean,
  align?: GtmActionMenuAlign,
  contentClassName?: string,
};

const destructiveItemClasses =
  "text-red-600 dark:text-red-400 focus:bg-red-500/10 data-[highlighted]:bg-red-500/10 dark:focus:bg-red-500/15 dark:data-[highlighted]:bg-red-500/15";

function GtmActionMenuAction(props: { item: GtmActionMenuItem, withIcons: boolean }) {
  const itemIcon = props.withIcons ? props.item.icon : undefined;
  if (props.item.items != null) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span className="flex min-w-0 items-center gap-2">
            {itemIcon != null && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {itemIcon}
              </span>
            )}
            <span className="truncate">{props.item.label}</span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="min-w-[180px]">
            {props.item.items.map((item) => (
              <GtmActionMenuAction key={item.id} item={item} withIcons={props.withIcons} />
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    );
  }

  const itemClasses = props.item.itemVariant === "destructive" ? destructiveItemClasses : undefined;
  return (
    <DropdownMenuItem
      icon={itemIcon}
      onClick={props.item.onClick}
      className={itemClasses}
    >
      {props.item.label}
    </DropdownMenuItem>
  );
}

export function GtmActionMenu(props: GtmActionMenuProps) {
  const align = props.align ?? "start";
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

        {props.items.map((item) => (
          <GtmActionMenuAction key={item.id} item={item} withIcons={props.withIcons ?? false} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
