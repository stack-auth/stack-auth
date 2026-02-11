"use client";

import { cn } from "@/lib/utils";
import { DesignButton } from "./button";
import { DesignMenu, type DesignMenuActionItem } from "./menu";

// ─── Button action types ──────────────────────────────────────────────────
// Each button in the row is either:
//   - A direct-click button (onClick is a function)
//   - A menu-trigger button  (onClick is an array of DesignMenuActionItem)

type DesignListItemButtonBase = {
  id: string,
  label: string,
  icon?: React.ReactNode,
  /** "icon" renders an icon-only button; "text" renders a labelled button. Defaults to "text". */
  display?: "icon" | "text",
};

type DesignListItemDirectButton = DesignListItemButtonBase & {
  onClick: () => void | Promise<void>,
};

type DesignListItemMenuButton = DesignListItemButtonBase & {
  onClick: DesignMenuActionItem[],
};

export type DesignListItemButton = DesignListItemDirectButton | DesignListItemMenuButton;

// ─── DesignListItemRow ────────────────────────────────────────────────────
//
// size="lg" (default) — card-style row with glassmorphic background, shadow,
//   large icon badge, bold title, and optional subtitle.
//
// size="sm" — flat compact row (like UserList items). No card background,
//   smaller icon, and a secondary subtitle line. Ideal for dense lists.

export type DesignListItemRowProps = {
  icon?: React.ElementType,
  title: string,
  subtitle?: string,
  /** "sm" = flat compact row, "lg" = card-style row. Defaults to "lg". */
  size?: "sm" | "lg",
  buttons?: DesignListItemButton[],
  onClick?: () => void,
  className?: string,
};

function ListItemButtons({ buttons }: { buttons: DesignListItemButton[] }) {
  return (
    <div className="relative flex items-center gap-2">
      {buttons.map((button) => {
        const display = button.display ?? "text";

        if (Array.isArray(button.onClick)) {
          const menuItems = button.onClick;
          return (
            <DesignMenu
              key={button.id}
              trigger={display === "icon" ? "icon" : "button"}
              triggerLabel={button.label}
              triggerIcon={display === "icon" ? button.icon : undefined}
              variant="actions"
              align="end"
              contentClassName="min-w-[180px]"
              items={menuItems}
            />
          );
        }

        const handler = button.onClick;

        if (display === "icon") {
          return (
            <DesignButton
              key={button.id}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
              onClick={handler}
              aria-label={button.label}
            >
              {button.icon}
            </DesignButton>
          );
        }

        return (
          <DesignButton
            key={button.id}
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg"
            onClick={handler}
          >
            {button.label}
          </DesignButton>
        );
      })}
    </div>
  );
}

export function DesignListItemRow({
  icon: Icon,
  title,
  subtitle,
  size = "lg",
  buttons,
  onClick,
  className,
}: DesignListItemRowProps) {
  const Wrapper = onClick ? "button" : "div";

  if (size === "sm") {
    return (
      <Wrapper
        {...(onClick ? { onClick, type: "button" as const } : {})}
        className={cn(
          "w-full flex items-center justify-between gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group",
          onClick && "hover:bg-foreground/[0.04]",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate text-foreground">{title}</div>
            {subtitle && (
              <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
            )}
          </div>
        </div>
        {buttons && buttons.length > 0 && <ListItemButtons buttons={buttons} />}
      </Wrapper>
    );
  }

  // size === "lg"
  return (
    <Wrapper
      {...(onClick ? { onClick, type: "button" as const } : {})}
      className={cn(
        "w-full group relative flex items-center justify-between p-4 rounded-2xl transition-all duration-150 hover:transition-none text-left",
        "bg-white/90 dark:bg-background/60 backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
        "shadow-sm hover:shadow-md",
        className,
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative flex items-center gap-4">
        {Icon && (
          <div className="p-2.5 rounded-xl bg-black/[0.08] dark:bg-white/[0.04] ring-1 ring-black/[0.1] dark:ring-white/[0.06] transition-colors duration-150 group-hover:bg-black/[0.12] dark:group-hover:bg-white/[0.08] group-hover:transition-none">
            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
          </div>
        )}
        <div className="min-w-0">
          <span className="font-semibold text-foreground">{title}</span>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
          )}
        </div>
      </div>
      {buttons && buttons.length > 0 && <ListItemButtons buttons={buttons} />}
    </Wrapper>
  );
}

// ─── DesignUserList ───────────────────────────────────────────────────────
// Convenience wrapper around DesignListItemRow for user rows with avatars.

export type DesignUserListRow = {
  name: string,
  email: string,
  time: string,
  color?: "cyan" | "blue",
};

export type DesignUserListProps = {
  users: DesignUserListRow[],
  onUserClick?: (user: DesignUserListRow) => void,
  showAvatar?: boolean,
  gradient?: "blue-purple" | "cyan-blue" | "none",
  className?: string,
};

const avatarGradients = new Map([
  ["blue-purple", "from-blue-500 to-purple-500"],
  ["cyan-blue", "from-cyan-500 to-blue-500"],
  ["none", "from-muted-foreground/30 to-muted-foreground/30"],
] as const);

function UserAvatar({ name, gradient }: { name: string, gradient: string }) {
  return (
    <div className={cn(
      "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-medium shrink-0",
      gradient,
    )}>
      {name.charAt(0)}
    </div>
  );
}

export function DesignUserList({
  users,
  onUserClick,
  showAvatar = true,
  gradient = "blue-purple",
  className,
}: DesignUserListProps) {
  const gradientClass = avatarGradients.get(gradient) ?? avatarGradients.get("blue-purple")!;

  return (
    <div className={cn("space-y-0.5 max-w-md", className)}>
      {users.map((user) => (
        <div key={user.email} className="flex items-center gap-3">
          {showAvatar && <UserAvatar name={user.name} gradient={gradientClass} />}
          <div className="flex-1 min-w-0">
            <DesignListItemRow
              title={user.name}
              subtitle={user.time}
              size="sm"
              onClick={onUserClick ? () => onUserClick(user) : undefined}
              className={cn(
                !showAvatar && "pl-0",
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
