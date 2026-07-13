"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  cn,
} from "@/components/ui";
import { SignInIcon, SignOutIcon, SunIcon, UserCircleIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useStackApp, useUser } from "@hexclave/next";
import { Suspense } from "react";

type DashboardUserButtonProps = {
  showUserInfo?: boolean,
  colorModeToggle?: () => void | Promise<void>,
  extraItems?: {
    text: string,
    icon: React.ReactNode,
    onClick: () => void | Promise<void>,
  }[],
};

type DashboardMenuItemProps = {
  text: string,
  icon: React.ReactNode,
  onClick: () => void | Promise<void>,
  variant?: "default" | "destructive",
};

const menuIconClassName = "h-4 w-4 shrink-0 text-muted-foreground";
const destructiveItemClasses =
  "text-red-600 dark:text-red-400 focus:bg-red-500/10 data-[highlighted]:bg-red-500/10 dark:focus:bg-red-500/15 dark:data-[highlighted]:bg-red-500/15";

function DashboardUserAvatar(props: {
  size?: number,
  user: ReturnType<typeof useUser>,
}) {
  const size = props.size ?? 34;
  const user = props.user;
  const initials = user == null ? null : (user.displayName ?? user.primaryEmail)?.slice(0, 2).toUpperCase();

  return (
    <Avatar
      className="bg-zinc-100 text-foreground ring-1 ring-black/[0.06] dark:bg-foreground/[0.08] dark:ring-white/[0.08]"
      style={{ height: size, width: size }}
    >
      <AvatarImage src={user?.profileImageUrl ?? ""} />
      <AvatarFallback className="text-zinc-500 dark:text-zinc-400">
        {initials == null ? (
          <UserCircleIcon size={size * 0.65} />
        ) : (
          <span className="font-medium" style={{ fontSize: size * 0.4 }}>
            {initials}
          </span>
        )}
      </AvatarFallback>
    </Avatar>
  );
}

function DashboardMenuItem(props: DashboardMenuItemProps) {
  return (
    <DropdownMenuItem
      icon={props.icon}
      onClick={props.onClick}
      className={props.variant === "destructive" ? destructiveItemClasses : undefined}
    >
      {props.text}
    </DropdownMenuItem>
  );
}

export function DashboardUserButton(props: DashboardUserButtonProps) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-[34px] rounded-full stack-scope" />}>
      <DashboardUserButtonInner {...props} />
    </Suspense>
  );
}

function DashboardUserButtonInner(props: DashboardUserButtonProps) {
  const user = useUser();
  const app = useStackApp();
  // Soft-navigate: redirectToAccountSettings() hard-reloads, which wipes preview mode's
  // in-memory session and bounces the user to sign-in. router.push keeps the session alive.
  const navigate = app.useNavigate();
  const showUserInfo = props.showUserInfo === true;
  const displayName = user?.displayName ?? user?.primaryEmail ?? "Account";
  const iconProps = { size: 16, className: menuIconClassName };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "outline-none stack-scope border-0 bg-transparent shadow-none transition-colors duration-150 hover:transition-none",
          "hover:bg-zinc-100/80 dark:hover:bg-foreground/[0.06]",
          "data-[state=open]:bg-zinc-100/90 dark:data-[state=open]:bg-foreground/[0.08]",
          "focus-visible:outline-none focus-visible:ring-0",
          showUserInfo
            ? "w-full overflow-hidden rounded-lg p-2"
            : "rounded-xl p-1.5 focus-visible:ring-2 focus-visible:ring-black/[0.08] dark:focus-visible:ring-white/[0.12]",
        )}
      >
        <div className={cn("flex min-w-0 items-center gap-2", showUserInfo && "w-full")}>
          <DashboardUserAvatar user={user} size={showUserInfo ? 32 : 34} />
          {user && showUserInfo && (
            <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden text-left">
              <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
              {user.primaryEmail != null && user.primaryEmail !== displayName && (
                <div className="truncate text-xs text-muted-foreground">{user.primaryEmail}</div>
              )}
            </div>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="stack-scope w-[240px] p-1.5"
        align={showUserInfo ? "start" : "end"}
        side={showUserInfo ? "top" : "bottom"}
        sideOffset={showUserInfo ? 8 : 6}
      >
        <DropdownMenuLabel className="cursor-default px-3 py-2.5 font-normal">
          <div className="flex min-w-0 items-center gap-3">
            <DashboardUserAvatar user={user} size={40} />
            <div className="min-w-0 flex-1">
              {user ? (
                <>
                  <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.primaryEmail}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not signed in</p>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-0 my-1 bg-black/[0.06] dark:bg-border/60" />
        {user && (
          <DashboardMenuItem
            text="Account settings"
            onClick={() => navigate("/handler/account-settings")}
            icon={<UserCircleIcon {...iconProps} />}
          />
        )}
        {!user && (
          <DashboardMenuItem
            text="Sign in"
            onClick={async () => await app.redirectToSignIn()}
            icon={<SignInIcon {...iconProps} />}
          />
        )}
        {!user && (
          <DashboardMenuItem
            text="Sign up"
            onClick={async () => await app.redirectToSignUp()}
            icon={<UserPlusIcon {...iconProps} />}
          />
        )}
        {user && props.extraItems?.map((item, index) => (
          <DashboardMenuItem key={index} text={item.text} onClick={item.onClick} icon={item.icon} />
        ))}
        {props.colorModeToggle && (
          <DashboardMenuItem
            text="Toggle theme"
            onClick={props.colorModeToggle}
            icon={<SunIcon {...iconProps} />}
          />
        )}
        {user && (
          <>
            <DropdownMenuSeparator className="mx-0 my-1 bg-black/[0.06] dark:bg-border/60" />
            <DashboardMenuItem
              text="Sign out"
              variant="destructive"
              onClick={async () => await user.signOut()}
              icon={(
                <span className={cn(menuIconClassName, "text-red-500/80 dark:text-red-400/80")}>
                  <SignOutIcon size={16} />
                </span>
              )}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
