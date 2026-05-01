import { BracketsCurlyIcon, ChartLineIcon, CheckIcon,
  ClipboardTextIcon,
  CreditCardIcon,
  EnvelopeSimpleIcon,
  FingerprintSimpleIcon,
  KeyIcon,
  LockIcon,
  MailboxIcon,
  PlugsConnectedIcon,
  RocketIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TelevisionSimpleIcon,
  UserGearIcon,
  UsersIcon,
  VaultIcon,
  WebhooksLogoIcon } from "@phosphor-icons/react"
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

import type { VisibleAppId } from "@/hooks/projects/use-apps-page"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export const APP_ICONS: Record<VisibleAppId, PhosphorIcon> = {
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

type AppCardProps = {
  appId: VisibleAppId,
  enabled: boolean,
  onToggle?: () => void,
  required?: boolean,
  control?: ReactNode,
  asButton?: boolean,
  className?: string,
}

export function AppCard({
  appId,
  enabled,
  onToggle,
  required = false,
  control,
  asButton = false,
  className,
}: AppCardProps) {
  const app = ALL_APPS[appId]
  const Icon = APP_ICONS[appId]

  const containerClass = cn(
    "group/app-card flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:transition-none",
    enabled
      ? "border-primary/40 bg-primary/[0.03] hover:border-primary/60"
      : "hover:border-foreground/30",
    required && "cursor-not-allowed",
    className,
  )

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md",
            enabled
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" weight={enabled ? "fill" : "regular"} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-heading text-sm font-medium">
              {app.displayName}
            </h3>
            {app.stage !== "stable" ? (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[9px] tracking-wider uppercase",
                  app.stage === "alpha"
                    ? "border-orange-500/40 text-orange-600 dark:text-orange-400"
                    : "border-blue-500/40 text-blue-600 dark:text-blue-400",
                )}
              >
                {app.stage}
              </Badge>
            ) : null}
            {asButton ? (
              <span
                className={cn(
                  "ms-auto flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  enabled
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-transparent",
                )}
                aria-hidden="true"
              >
                {required ? (
                  <LockIcon className="size-2.5 text-muted-foreground" weight="fill" />
                ) : enabled ? (
                  <CheckIcon className="size-2.5" weight="bold" />
                ) : null}
              </span>
            ) : enabled ? (
              <span
                className="ms-auto inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                aria-label="Enabled"
              >
                <CheckIcon className="size-2.5" weight="bold" />
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {app.subtitle}
          </p>
        </div>
      </div>

      {control || app.tags.length > 0 ? (
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {app.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
              >
                {tag}
              </span>
            ))}
          </div>
          {control}
        </div>
      ) : null}
    </>
  )

  if (asButton) {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={required}
        aria-pressed={enabled}
        className={containerClass}
      >
        {inner}
      </button>
    )
  }

  return <div className={containerClass}>{inner}</div>
}
