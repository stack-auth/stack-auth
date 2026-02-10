"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { DotsThree } from "@phosphor-icons/react";
import { DesignButton } from "./button";

export type DesignListItemRowProps = {
  icon: React.ElementType,
  title: string,
  showIcon?: boolean,
  onEdit?: () => void,
  onDelete?: () => void,
};

export function DesignListItemRow({
  icon: Icon,
  title,
  showIcon = true,
  onEdit,
  onDelete,
}: DesignListItemRowProps) {
  return (
    <div className={cn(
      "group relative flex items-center justify-between p-4 rounded-2xl transition-all duration-150 hover:transition-none",
      "bg-white/90 dark:bg-background/60 backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
      "shadow-sm hover:shadow-md"
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative flex items-center gap-4">
        {showIcon && (
          <div className="p-2.5 rounded-xl bg-black/[0.08] dark:bg-white/[0.04] ring-1 ring-black/[0.1] dark:ring-white/[0.06] transition-colors duration-150 group-hover:bg-black/[0.12] dark:group-hover:bg-white/[0.08] group-hover:transition-none">
            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
          </div>
        )}
        <span className="font-semibold text-foreground">{title}</span>
      </div>
      <div className="relative flex items-center gap-2">
        {onEdit && (
          <DesignButton
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg"
            onClick={onEdit}
          >
            Edit
          </DesignButton>
        )}
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <DesignButton
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg"
              >
                <DotsThree size={20} weight="bold" />
              </DesignButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem onClick={onDelete} className="py-2.5 text-red-600 dark:text-red-400 focus:bg-red-500/10 cursor-pointer justify-center">
                <span className="font-medium">Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

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

const avatarGradients = {
  "blue-purple": "from-blue-500 to-purple-500",
  "cyan-blue": "from-cyan-500 to-blue-500",
  "none": "from-muted-foreground/30 to-muted-foreground/30",
} as const;

export function DesignUserList({
  users,
  onUserClick,
  showAvatar = true,
  gradient = "blue-purple",
  className,
}: DesignUserListProps) {
  return (
    <div className={cn("space-y-0.5 max-w-md", className)}>
      {users.map((user) => (
        <button
          key={user.email}
          onClick={() => onUserClick?.(user)}
          className={cn(
            "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group",
            user.color === "cyan" ? "hover:bg-cyan-500/[0.1]" : "hover:bg-blue-500/[0.1]"
          )}
        >
          {showAvatar && (
            <div className={cn(
              "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-medium shrink-0",
              avatarGradients[gradient]
            )}>
              {user.name.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate text-foreground">{user.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user.time}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
