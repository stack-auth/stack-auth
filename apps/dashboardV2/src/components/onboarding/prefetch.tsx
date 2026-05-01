import { Suspense } from "react"
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

import { useEmailPreviewQuery, useEmailThemesQuery } from "@/lib/stack/react-query"

export function OnboardingPrefetcher({ project }: { project: AdminOwnedProject }) {
  return (
    <div aria-hidden className="hidden">
      <Suspense fallback={null}>
        <EmailThemePrefetch project={project} />
      </Suspense>
    </div>
  )
}

function EmailThemePrefetch({ project }: { project: AdminOwnedProject }) {
  const themes = useEmailThemesQuery(project.app).data ?? []
  return (
    <>
      {themes.map((t) => (
        <Suspense key={t.id} fallback={null}>
          <EmailPreviewPrefetch project={project} themeId={t.id} />
        </Suspense>
      ))}
    </>
  )
}

function EmailPreviewPrefetch({
  project,
  themeId,
}: {
  project: AdminOwnedProject,
  themeId: string,
}) {
  useEmailPreviewQuery({
    themeId,
    templateTsxSource: previewTemplateSource,
  }, project.app)
  return null
}
