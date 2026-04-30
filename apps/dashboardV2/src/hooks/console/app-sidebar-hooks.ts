import { useRouterState } from "@tanstack/react-router"
import { useUser } from "@stackframe/tanstack-start"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

type ThemeChoice = "system" | "light" | "dark"

export function useAppSidebar() {
  const user = useUser()
  const { location } = useRouterState()

  return {
    user,
    location,
    initials: getInitials(user?.displayName ?? user?.primaryEmail ?? "?"),
  }
}

export function useThemeToggleButton() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const current: ThemeChoice = isThemeChoice(theme) ? theme : "system"
  const next: ThemeChoice =
    current === "system" ? "light" : current === "light" ? "dark" : "system"

  const label = mounted ? `Theme: ${current} (click for ${next})` : "Theme"

  return { mounted, current, next, label, setTheme }
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark"
}
