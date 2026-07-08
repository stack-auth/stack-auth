"use client";

import { DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, ChartBarIcon, CheckCircleIcon, LightningIcon, SparkleIcon } from "@phosphor-icons/react";
import type { DailyBrief, DailyBriefBullet, DailyBriefSuggestion } from "./mock-data";

export function SuggestionActionCard({
  suggestion,
  completed,
  onApply,
  compact = false,
}: {
  suggestion: DailyBriefSuggestion,
  completed: boolean,
  onApply: (suggestionId: string) => void,
  compact?: boolean,
}) {
  return (
    <div
      data-completed={completed ? "true" : "false"}
      className={cn(
        "rounded-2xl border border-blue-500/15 bg-blue-500/[0.06] p-4 ring-1 ring-blue-500/10 transition-all duration-150 hover:transition-none",
        "data-[completed=true]:border-emerald-500/20 data-[completed=true]:bg-emerald-500/[0.08] data-[completed=true]:ring-emerald-500/15",
        completed && "scale-[0.99]",
        compact && "p-3",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <DesignBadge
              label={completed ? "Completed" : "AI suggestion"}
              color={completed ? "green" : "blue"}
              icon={completed ? CheckCircleIcon : SparkleIcon}
              size="sm"
            />
            <span className="text-xs font-semibold text-foreground">
              {suggestion.title}
            </span>
          </div>
          <p className={cn("text-sm text-muted-foreground", compact && "text-xs")}>
            {suggestion.summary}
          </p>
          <p className="text-xs font-medium text-foreground">
            {suggestion.impact}
          </p>
        </div>
        <DesignButton
          size="sm"
          variant={completed ? "secondary" : "default"}
          disabled={completed}
          onClick={() => onApply(suggestion.id)}
          className={cn(
            "shrink-0 transition-all duration-150 hover:transition-none",
            completed && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            {completed ? <CheckCircleIcon className="h-3.5 w-3.5" weight="fill" /> : null}
            {completed ? "Completed" : suggestion.actionLabel}
          </span>
        </DesignButton>
      </div>
    </div>
  );
}

export function DailyBriefOverviewCard({
  brief,
  projectId,
}: {
  brief: DailyBrief,
  projectId: string,
}) {
  const previewBullets: DailyBriefBullet[] = brief.sections.flatMap((section) => section.blocks.flatMap((block) => block.type === "bullets" ? block.bullets : [])).slice(0, 3);
  const suggestionCount = brief.sections.flatMap((section) => section.blocks.filter((block) => block.type === "suggestion")).length;
  const coreMetrics = brief.sections.flatMap((section) => section.blocks.flatMap((block) => block.type === "metrics" ? block.metrics : [])).slice(0, 2);

  return (
    <DesignCard
      title="Today's Daily Brief"
      subtitle="Daily notes for Demo Project"
      icon={SparkleIcon}
      gradient="purple"
      actions={
        <DesignBadge
          label={`${suggestionCount} suggestions`}
          color="purple"
          icon={LightningIcon}
          size="sm"
        />
      }
      contentClassName="space-y-4"
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{brief.dateLabel}</span>
              <span aria-hidden>/</span>
              <span>{brief.readTime}</span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {brief.title}
            </h2>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
            {previewBullets.map((bullet) => (
              <li key={bullet.label} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500/70" />
                <span>
                  <span className="font-medium text-foreground">{bullet.label}:</span>{" "}
                  {bullet.text}
                </span>
              </li>
            ))}
          </ul>
          <DesignButton asChild variant="outline" size="sm" className="w-fit">
            <Link href={`/projects/${encodeURIComponent(projectId)}/daily-brief`}>
              <span className="inline-flex items-center gap-1.5">
                Read full brief
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </span>
            </Link>
          </DesignButton>
        </div>
        <div className="rounded-2xl bg-foreground/[0.04] p-4 ring-1 ring-foreground/[0.08]">
          <div className="mb-3 flex items-center gap-2">
            <ChartBarIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Briefing signals
            </span>
          </div>
          <div className="space-y-3 text-sm">
            {coreMetrics.map((metric) => (
              <div key={metric.label}>
                <div className="text-lg font-semibold tabular-nums text-foreground">{metric.value}</div>
                <div className="text-xs text-muted-foreground">{metric.label} / {metric.delta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DesignCard>
  );
}
