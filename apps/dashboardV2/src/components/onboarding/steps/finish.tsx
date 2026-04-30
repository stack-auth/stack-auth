import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config"
import { ArrowRightIcon, CheckCircleIcon, CheckIcon } from "@phosphor-icons/react"
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

const REQUIRED_APPS: Array<AppId> = ["authentication", "emails"]

type FinishStepProps = {
  project: AdminOwnedProject,
  displayName: string,
  selectedApps: Set<AppId>,
  submitting: boolean,
  onFinish: () => void,
}

export function FinishStep({
  displayName,
  selectedApps,
  submitting,
  onFinish,
}: FinishStepProps) {
  const trimmedName = displayName.trim()
  const projectName = trimmedName.length > 0 ? trimmedName : "your project"

  const allIds = Object.keys(ALL_APPS) as Array<AppId>
  const requiredSet = new Set<AppId>(REQUIRED_APPS)
  const installedIds = allIds.filter((id) => selectedApps.has(id))
  const orderedInstalled = [
    ...REQUIRED_APPS.filter((id) => selectedApps.has(id)),
    ...installedIds
      .filter((id) => !requiredSet.has(id))
      .sort((a, b) => ALL_APPS[a].displayName.localeCompare(ALL_APPS[b].displayName)),
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-4">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          All set
        </p>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <CheckCircleIcon className="size-7" weight="duotone" />
        </div>
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Welcome to {projectName}
          </h2>
          <p className="text-sm text-muted-foreground">
            Your project is configured and ready to use. Drop the SDK into your
            app or explore the dashboard to start sending traffic.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Installed apps
        </p>
        <div className="rounded-lg bg-card p-1 ring-1 ring-foreground/10">
          <ul className="divide-y divide-foreground/5">
            {orderedInstalled.map((appId) => {
              const meta = ALL_APPS[appId]
              return (
                <li
                  key={appId}
                  className="flex items-start gap-3 px-3 py-2.5"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CheckIcon className="size-3" weight="bold" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-heading text-sm font-medium tracking-tight">
                      {meta.displayName}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {meta.subtitle}
                    </p>
                  </div>
                  {requiredSet.has(appId) && (
                    <span className="mt-0.5 inline-flex rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                      Required
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <div className="space-y-3">
        <Button
          size="sm"
          onClick={onFinish}
          disabled={submitting}
          className="w-full sm:w-auto"
        >
          {submitting ? <Spinner className="size-3.5" /> : null}
          Open project
          {!submitting && <ArrowRightIcon />}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Everything here can be changed later in project settings.
        </p>
      </div>
    </div>
  )
}
