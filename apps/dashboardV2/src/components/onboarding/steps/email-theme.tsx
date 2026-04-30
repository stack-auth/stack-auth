import { CheckIcon, PaintBrushIcon } from "@phosphor-icons/react"
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

import { cn } from "@/lib/utils"
import { useEmailThemeStep } from "@/hooks/onboarding/use-email-theme-step"

type EmailThemeStepProps = {
  project: AdminOwnedProject,
  selectedThemeId: string | null,
  setSelectedThemeId: (id: string) => void,
}

export function EmailThemeStep({
  project,
  selectedThemeId,
  setSelectedThemeId,
}: EmailThemeStepProps) {
  const { themes, effectiveSelected } = useEmailThemeStep({
    project,
    selectedThemeId,
    setSelectedThemeId,
  })

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Step 4
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Pick an email theme
        </h2>
        <p className="text-sm text-muted-foreground">
          Sets the look of transactional emails (verification, password reset,
          etc). You can change this anytime from project settings.
        </p>
      </div>

      {themes.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
          <PaintBrushIcon className="size-4" />
          No themes available right now. You can continue and pick one later.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => {
            const selected = effectiveSelected === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedThemeId(t.id)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:transition-none",
                  selected
                    ? "border-primary/40 bg-primary/[0.03]"
                    : "hover:border-foreground/30",
                )}
              >
                <div className="aspect-[4/3] overflow-hidden border-b bg-background">
                  <div
                    className="pointer-events-none origin-top-left"
                    style={{
                      transform: "scale(0.5)",
                      width: "200%",
                      height: "200%",
                    }}
                  >
                    <ThemePreview project={project} themeId={t.id} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="truncate font-heading text-sm font-medium tracking-tight">
                    {t.displayName}
                  </span>
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-transparent",
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <CheckIcon className="size-2.5" weight="bold" /> : null}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ThemePreview({
  project,
  themeId,
}: {
  project: AdminOwnedProject,
  themeId: string,
}) {
  const previewHtml = project.app.useEmailPreview({
    themeId,
    templateTsxSource: previewTemplateSource,
  })

  return (
    <iframe
      srcDoc={previewHtml}
      sandbox=""
      className="pointer-events-none h-full w-full border-0"
      title="Email theme preview"
    />
  )
}

