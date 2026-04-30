import { useEffect } from "react"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

export type UseEmailThemeStepOptions = {
  project: AdminOwnedProject,
  selectedThemeId: string | null,
  setSelectedThemeId: (id: string) => void,
}

export function useEmailThemeStep({
  project,
  selectedThemeId,
  setSelectedThemeId,
}: UseEmailThemeStepOptions) {
  const themes = project.app.useEmailThemes()
  const config = project.useConfig()
  const currentId = config.emails.selectedThemeId

  useEffect(() => {
    if (selectedThemeId == null && currentId) {
      setSelectedThemeId(currentId)
    }
    // We only want to seed once, when nothing is selected.
  }, [currentId, selectedThemeId, setSelectedThemeId])

  const effectiveSelected = selectedThemeId ?? currentId

  return { themes, effectiveSelected }
}
