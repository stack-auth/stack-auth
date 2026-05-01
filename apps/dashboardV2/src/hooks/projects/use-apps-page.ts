import { useMemo, useState } from "react"
import {
  BracketsCurlyIcon,
  ChartLineIcon,
  ClipboardTextIcon,
  CreditCardIcon,
  EnvelopeSimpleIcon,
  FingerprintSimpleIcon,
  KeyIcon,
  MailboxIcon,
  PlugsConnectedIcon,
  RocketIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TelevisionSimpleIcon,
  UserGearIcon,
  UsersIcon,
  VaultIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react"
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config"
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { AdminProject } from "@stackframe/tanstack-start"

import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"

// Apps hidden from the dashboardV2 explore page even when present in shared config.
const HIDDEN_APP_IDS = new Set<AppId>(["feature-flags"])

export type VisibleAppId = Exclude<AppId, "feature-flags">

const APP_ICONS: Record<VisibleAppId, PhosphorIcon> = {
  authentication: FingerprintSimpleIcon,
  "fraud-protection": ShieldCheckIcon,
  onboarding: ClipboardTextIcon,
  teams: UsersIcon,
  rbac: UserGearIcon,
  "api-keys": KeyIcon,
  payments: CreditCardIcon,
  emails: EnvelopeSimpleIcon,
  "email-api": MailboxIcon,
  "data-vault": VaultIcon,
  webhooks: WebhooksLogoIcon,
  "tv-mode": TelevisionSimpleIcon,
  "launch-checklist": RocketIcon,
  catalyst: SparkleIcon,
  neon: PlugsConnectedIcon,
  convex: PlugsConnectedIcon,
  vercel: PlugsConnectedIcon,
  "tanstack-start": BracketsCurlyIcon,
  analytics: ChartLineIcon,
}

type Category = {
  id: string,
  label: string,
  // null tags means "all" (no tag filter); empty tags means special filter handled inline
  tags: ReadonlyArray<string> | null,
}

export const APP_CATEGORIES: ReadonlyArray<Category> = [
  { id: "all", label: "All", tags: null },
  { id: "installed", label: "Installed", tags: [] },
  { id: "auth", label: "Authentication", tags: ["auth"] },
  { id: "developer", label: "Developer", tags: ["developers"] },
  { id: "integration", label: "Integrations", tags: ["integration"] },
  { id: "advanced", label: "Advanced", tags: ["expert", "security", "storage", "operations"] },
]

export const ALL_APP_IDS = (Object.keys(ALL_APPS) as ReadonlyArray<VisibleAppId>)
  .filter((id): id is VisibleAppId => !HIDDEN_APP_IDS.has(id))

export function isAppEnabled(
  installed: Record<string, { enabled?: boolean } | undefined>,
  appId: AppId,
) {
  return installed[appId]?.enabled === true
}

export function useAppsPage() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")

  // The schema declares `apps.installed` as `Record<string, { enabled: boolean } | undefined>`.
  // We narrow `enabled` to optional on read because legacy entries may pre-date the field.
  const installedApps = config.apps.installed as Record<string, { enabled?: boolean } | undefined>

  const enabledIds = useMemo(
    () => ALL_APP_IDS.filter((id) => isAppEnabled(installedApps, id)),
    [installedApps],
  )

  const filteredAppIds = useMemo(() => {
    let ids: ReadonlyArray<VisibleAppId> = ALL_APP_IDS

    const category = APP_CATEGORIES.find((c) => c.id === selectedCategory)
    if (category != null) {
      if (category.id === "installed") {
        ids = ids.filter((id) => isAppEnabled(installedApps, id))
      } else if (category.tags != null && category.tags.length > 0) {
        const tags = category.tags
        ids = ids.filter((id) =>
          ALL_APPS[id].tags.some((tag) => tags.includes(tag)),
        )
      }
    }

    if (searchQuery.length > 0) {
      const q = searchQuery.toLowerCase()
      ids = ids.filter((id) => {
        const app = ALL_APPS[id]
        return (
          app.displayName.toLowerCase().includes(q)
          || app.subtitle.toLowerCase().includes(q)
          || app.tags.some((tag) => tag.toLowerCase().includes(q))
        )
      })
    }

    return [...ids].sort((a, b) => {
      const aEnabled = isAppEnabled(installedApps, a)
      const bEnabled = isAppEnabled(installedApps, b)
      if (aEnabled !== bEnabled) return aEnabled ? -1 : 1
      return stringCompare(ALL_APPS[a].displayName, ALL_APPS[b].displayName)
    })
  }, [installedApps, searchQuery, selectedCategory])

  const categoryCount = (categoryId: string) => {
    if (categoryId === "all") return ALL_APP_IDS.length
    if (categoryId === "installed") return enabledIds.length
    const category = APP_CATEGORIES.find((c) => c.id === categoryId)
    if (category == null || category.tags == null) return 0
    const tags = category.tags
    return ALL_APP_IDS.filter((id) =>
      ALL_APPS[id].tags.some((tag) => tags.includes(tag)),
    ).length
  }

  return {
    project,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    installedApps,
    enabledIds,
    filteredAppIds,
    categoryCount,
  }
}

export function useAppCard({
  appId,
  project,
}: {
  appId: VisibleAppId,
  project: AdminProject,
}) {
  const app = ALL_APPS[appId]
  const Icon = APP_ICONS[appId]
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const setEnabled = async (next: boolean) => {
    setPending(true)
    try {
      await project.updateConfig({ [`apps.installed.${appId}.enabled`]: next })
      await invalidateProjectConfig(project.id)
    } finally {
      setPending(false)
    }
  }

  const handleSwitch = (next: boolean) => {
    // Confirm before enabling alpha/beta apps. Disabling never needs confirmation.
    if (next && app.stage !== "stable") {
      setConfirmOpen(true)
      return
    }
    runAsynchronouslyWithAlert(setEnabled(next))
  }

  const enableConfirmed = () => {
    setConfirmOpen(false)
    runAsynchronouslyWithAlert(setEnabled(true))
  }

  return { app, Icon, confirmOpen, setConfirmOpen, pending, handleSwitch, enableConfirmed }
}
