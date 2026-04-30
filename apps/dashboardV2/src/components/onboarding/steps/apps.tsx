import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

import { AppCard } from "@/components/console/app-card"
import { useAppsStep } from "@/hooks/onboarding/use-apps-step"

type AppsStepProps = {
  project: AdminOwnedProject,
  selected: Set<AppId>,
  setSelected: React.Dispatch<React.SetStateAction<Set<AppId>>>,
}

export function AppsStep({ selected, setSelected }: AppsStepProps) {
  const { primaryAppIds, secondaryAppIds, toggle, isRequired } = useAppsStep({ setSelected })

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Step 2
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Select apps
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose the building blocks to install for this project. You can enable
          more later from project settings.
        </p>
      </div>

      <section className="space-y-3">
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Core
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {primaryAppIds.map((appId) => (
            <AppCard
              key={appId}
              appId={appId}
              enabled={selected.has(appId)}
              required={isRequired(appId)}
              onToggle={() => toggle(appId)}
              asButton
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          More apps
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {secondaryAppIds.map((appId) => (
            <AppCard
              key={appId}
              appId={appId}
              enabled={selected.has(appId)}
              required={false}
              onToggle={() => toggle(appId)}
              asButton
            />
          ))}
        </div>
      </section>
    </div>
  )
}
