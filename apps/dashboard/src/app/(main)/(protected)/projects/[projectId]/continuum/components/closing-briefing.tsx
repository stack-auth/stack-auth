import { DesignBadge, DesignCard } from "@/components/design-components";
import { CheckCircleIcon, NewspaperClippingIcon, ShieldCheckIcon, TimerIcon } from "@phosphor-icons/react";
import type { ContinuumIncidentStory } from "../fixtures/types";

export function ClosingBriefing({ closingCard }: { closingCard: ContinuumIncidentStory["closingCard"] }) {
  return (
    <DesignCard
      title="Daily Briefing"
      subtitle={closingCard.title}
      icon={NewspaperClippingIcon}
      gradient="green"
      actions={<DesignBadge label="Incident closed" color="green" icon={CheckCircleIcon} size="sm" />}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.45fr)_minmax(14rem,0.45fr)]">
        <ul className="space-y-2 rounded-xl bg-foreground/[0.035] p-4">
          {closingCard.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-sm text-foreground">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" weight="fill" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col justify-between rounded-xl bg-cyan-500/[0.07] p-4 ring-1 ring-cyan-500/15">
          <TimerIcon className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          <div className="mt-5">
            <div className="font-mono text-3xl font-semibold tabular-nums text-foreground">
              {closingCard.avoidedDowntimeMinutes}
            </div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              minutes of downtime avoided
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-xl bg-emerald-500/[0.07] p-4 ring-1 ring-emerald-500/15">
          <ShieldCheckIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <div className="mt-5">
            <div className="font-mono text-3xl font-semibold tabular-nums text-foreground">
              {closingCard.protectedArrUsd.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })}
            </div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              annual revenue protected
            </div>
          </div>
        </div>
      </div>
    </DesignCard>
  );
}
