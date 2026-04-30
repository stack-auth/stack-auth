import { useEffect, useState } from "react"
import { useRouterState } from "@tanstack/react-router"
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"

import { useAdminApp } from "@/lib/stack/admin-app"

export type ProjectSidebarNavTo =
  | "/projects/$projectId"
  | "/projects/$projectId/dashboards"
  | "/projects/$projectId/users"
  | "/projects/$projectId/teams"
  | "/projects/$projectId/auth-methods"
  | "/projects/$projectId/onboarding"
  | "/projects/$projectId/permissions"
  | "/projects/$projectId/emails"
  | "/projects/$projectId/webhooks"
  | "/projects/$projectId/payments"
  | "/projects/$projectId/events"
  | "/projects/$projectId/session-replays"
  | "/projects/$projectId/apps"
  | "/projects/$projectId/api-keys"
  | "/projects/$projectId/settings"

export type ProjectSidebarNavItem<TIcon> = {
  to: ProjectSidebarNavTo,
  label: string,
  Icon: TIcon,
  exact?: boolean,
  /** When set, the item only renders if the app is enabled in `config.apps.installed`. */
  appId?: AppId,
}

export type ProjectSidebarNavGroup<TIcon> = {
  label: string,
  items: ReadonlyArray<ProjectSidebarNavItem<TIcon>>,
}

export function useProjectSidebar<TIcon>(
  navGroups: ReadonlyArray<ProjectSidebarNavGroup<TIcon>>,
) {
  const adminApp = useAdminApp()
  const project = adminApp.useProject()
  const config = project.useConfig()
  const projectId = project.id
  const { location } = useRouterState()
  // Detect platform on the client. Pre-mount we render the Windows/Linux label
  // (the majority case); after hydration we swap to the Mac symbol if applicable.
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(
      navigator.platform.toUpperCase().includes("MAC")
        || /Mac|iP(hone|od|ad)/.test(navigator.userAgent)
    )
  }, [])

  const installedApps = config.apps.installed as Record<string, { enabled?: boolean } | undefined>
  const isAppEnabled = (appId: AppId | undefined) =>
    appId == null ? true : installedApps[appId]?.enabled === true

  const isActive = (to: ProjectSidebarNavTo, exact: boolean | undefined) => {
    const href = to.replace("$projectId", projectId)
    return exact ? location.pathname === href : location.pathname.startsWith(href)
  }

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAppEnabled(item.appId)),
    }))
    .filter((group) => group.items.length > 0)

  return { project, projectId, isMac, visibleGroups, isActive }
}
