import { Link } from "@tanstack/react-router"
import {
  BookOpenIcon,
  ClockClockwiseIcon,
  GearSixIcon,
  LifebuoyIcon,
  MonitorIcon,
  MoonIcon,
  SignOutIcon,
  SparkleIcon,
  SquaresFourIcon,
  SunIcon,
} from "@phosphor-icons/react"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAppSidebar, useThemeToggleButton } from "@/hooks/console/app-sidebar-hooks"

const NAV_ITEMS = [
  { to: "/projects", label: "Projects", Icon: SquaresFourIcon },
] as const

const CENTER_ACTION_ITEMS: ReadonlyArray<{
  href: string,
  label: string,
  Icon: PhosphorIcon,
}> = [
  { href: "https://docs.stack-auth.com#stack-auth-ai", label: "Ask AI", Icon: SparkleIcon },
  { href: "https://github.com/stack-auth/stack-auth/blob/dev/CHANGELOG.md", label: "Changelog", Icon: ClockClockwiseIcon },
  { href: "https://discord.stack-auth.com", label: "Support", Icon: LifebuoyIcon },
  { href: "https://docs.stack-auth.com", label: "Docs", Icon: BookOpenIcon },
] as const

export function AppSidebar() {
  const { user, location, initials } = useAppSidebar()

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex h-svh w-(--app-sidebar-width) flex-col items-center overflow-hidden rounded-e-lg border-e bg-sidebar pb-2">
      <div className="flex h-[52px] w-full items-center justify-center">
        <Button
          size="icon-lg"
          aria-label="Stack Auth"
          className="bg-primary text-primary-foreground hover:bg-primary/80"
          nativeButton={false}
          render={<Link to="/projects" />}
        >
          <img src="/logo.svg" alt="" className="h-5 w-auto invert dark:invert-0" />
        </Button>
      </div>

      <nav className="mt-2 flex flex-col items-center gap-1">
        {NAV_ITEMS.map(({ to, label, Icon }) => {
          const isActive = location.pathname.startsWith(to)
          return (
            <Button
              key={to}
              variant="ghost"
              size="icon-lg"
              aria-label={label}
              title={label}
              data-active={isActive || undefined}
              className="data-[active]:bg-muted data-[active]:text-foreground"
              nativeButton={false}
              render={<Link to={to} />}
            >
              <Icon weight={isActive ? "fill" : "regular"} />
            </Button>
          )
        })}
      </nav>

      <div className="flex flex-1 items-center">
        <nav aria-label="Resources" className="flex flex-col items-center gap-1">
          {CENTER_ACTION_ITEMS.map((item) => (
            <IconRailLink key={item.href} {...item} />
          ))}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-1">
        <ThemeToggleButton />

        <DropdownMenu>
          <DropdownMenuTrigger
            id="app-sidebar-account-menu-trigger"
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={user?.displayName ?? "Account"}
                title={user?.displayName ?? "Account"}
              >
                <Avatar className="size-5">
                  <AvatarImage src={user?.profileImageUrl ?? undefined} alt="" />
                  <AvatarFallback className="text-[0.625rem]">
                    {initials || "?"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col">
                <span className="text-xs font-medium">
                  {user?.displayName ?? "Account"}
                </span>
                {user?.primaryEmail ? (
                  <span className="text-[0.7rem] font-normal text-muted-foreground">
                    {user.primaryEmail}
                  </span>
                ) : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/handler/account-settings" />}>
              <GearSixIcon />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => user?.signOut()}>
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

function IconRailLink({
  href,
  label,
  Icon,
}: {
  href: string,
  label: string,
  Icon: PhosphorIcon,
}) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noreferrer noopener" />}
    >
      <Icon />
    </Button>
  )
}

function ThemeToggleButton() {
  const { mounted, current, next, label, setTheme } = useThemeToggleButton()

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {mounted ? (
        current === "light" ? (
          <SunIcon />
        ) : current === "dark" ? (
          <MoonIcon />
        ) : (
          <MonitorIcon />
        )
      ) : (
        <MonitorIcon />
      )}
    </Button>
  )
}
