import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { Dispatch, SetStateAction } from "react"

import type { VisibleAppId } from "@/hooks/projects/use-apps-page"
import { ALL_APP_IDS } from "@/hooks/projects/use-apps-page"

const REQUIRED_APPS: Array<VisibleAppId> = ["authentication", "emails"]
const PRIMARY_APPS: Array<VisibleAppId> = ["authentication", "emails", "payments", "analytics"]

export function useAppsStep({
  setSelected,
}: {
  setSelected: Dispatch<SetStateAction<Set<AppId>>>,
}) {
  const allIds: ReadonlyArray<VisibleAppId> = ALL_APP_IDS
  const primarySet = new Set(PRIMARY_APPS)
  const primaryAppIds = PRIMARY_APPS.filter((id) => allIds.includes(id))
  const secondaryAppIds = allIds
    .filter((id) => !primarySet.has(id))
    .sort((a, b) => ALL_APPS[a].displayName.localeCompare(ALL_APPS[b].displayName))

  const toggle = (appId: VisibleAppId) => {
    if (REQUIRED_APPS.includes(appId)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  return {
    primaryAppIds,
    secondaryAppIds,
    toggle,
    isRequired: (appId: VisibleAppId) => REQUIRED_APPS.includes(appId),
  }
}
