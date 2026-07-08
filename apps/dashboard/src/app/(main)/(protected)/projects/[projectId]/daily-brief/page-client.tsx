"use client";

import { DesignBadge, DesignButton, DesignCard, DesignDialog, DesignDialogClose } from "@/components/design-components";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CheckCircleIcon, GearIcon, ImageIcon, LightningIcon, SparkleIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { SuggestionActionCard } from "../_daily-brief/components";
import { DAILY_BRIEFS, getAllDailyBriefSuggestions, type DailyBrief, type DailyBriefBlock, type DailyBriefImportantUser, type DailyBriefMetric, type DailyBriefVisual } from "../_daily-brief/mock-data";
import { PageLayout } from "../page-layout";

const WEEKDAYS = [
  { id: "mon", label: "Mo" },
  { id: "tue", label: "Tu" },
  { id: "wed", label: "We" },
  { id: "thu", label: "Th" },
  { id: "fri", label: "Fr" },
  { id: "sat", label: "Sa" },
  { id: "sun", label: "Su" },
] as const;

type WeekdayId = typeof WEEKDAYS[number]["id"];

function MetricsBlock({ metrics }: { metrics: DailyBriefMetric[] }) {
  return (
    <div className="grid gap-x-6 gap-y-3 border-l border-foreground/[0.08] pl-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metric.value}</div>
          <div className={cn(
            "mt-1 text-xs font-medium",
            metric.tone === "good" && "text-emerald-700 dark:text-emerald-300",
            metric.tone === "watch" && "text-amber-700 dark:text-amber-300",
            metric.tone === "neutral" && "text-muted-foreground",
          )}>
            {metric.delta}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersBlock({ users }: { users: DailyBriefImportantUser[] }) {
  return (
    <div className="grid gap-x-6 gap-y-4 border-l border-foreground/[0.08] pl-4 xl:grid-cols-3">
      {users.map((user) => (
        <div key={user.email} className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300">
              <UserCircleIcon className="h-5 w-5" weight="fill" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.company} / {user.email}</div>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {user.signal}
          </p>
        </div>
      ))}
    </div>
  );
}

function VisualBlock({ visual }: { visual: DailyBriefVisual }) {
  return (
    <div className="border-l border-foreground/[0.08] pl-4">
      <div className="max-w-3xl overflow-hidden rounded-xl border border-dashed border-foreground/[0.12] bg-foreground/[0.025]">
        <div className="relative h-40 bg-gradient-to-br from-purple-500/12 via-blue-500/8 to-cyan-500/12">
          <div className="absolute inset-x-6 bottom-6 grid grid-cols-5 items-end gap-2 opacity-80">
            {[42, 58, 36, 74, 91].map((height) => (
              <div key={height} className="rounded-t bg-foreground/20" style={{ height: height * 0.7 }} />
            ))}
          </div>
          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-background/75 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-foreground/[0.08] backdrop-blur-xl">
            <ImageIcon className="h-3.5 w-3.5" />
            {visual.kind === "chart" ? "Mock chart" : visual.kind === "map" ? "Mock journey map" : "Mock image"}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-sm font-semibold text-foreground">{visual.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{visual.caption}</p>
        </div>
      </div>
    </div>
  );
}

function DailyBriefBlockRenderer({
  block,
  completedSuggestionIds,
  onApplySuggestion,
}: {
  block: DailyBriefBlock,
  completedSuggestionIds: Set<string>,
  onApplySuggestion: (suggestionId: string) => void,
}) {
  switch (block.type) {
    case "bullets": {
      return (
        <ul className="max-w-4xl space-y-2.5 border-l border-foreground/[0.08] pl-4 text-sm leading-6 text-muted-foreground">
          {block.bullets.map((bullet) => (
            <li key={bullet.label} className="relative">
              <span aria-hidden className="absolute -left-[1.18rem] top-2.5 h-px w-3 bg-foreground/[0.16]" />
              <div className="text-sm font-semibold text-foreground">{bullet.label}</div>
              <div className="text-sm text-muted-foreground">{bullet.text}</div>
            </li>
          ))}
        </ul>
      );
    }
    case "metrics": {
      return <MetricsBlock metrics={block.metrics} />;
    }
    case "users": {
      return <UsersBlock users={block.users} />;
    }
    case "visual": {
      return <VisualBlock visual={block.visual} />;
    }
    case "suggestion": {
      return (
        <SuggestionActionCard
          suggestion={block.suggestion}
          completed={completedSuggestionIds.has(block.suggestion.id)}
          onApply={onApplySuggestion}
        />
      );
    }
  }
}

function BriefTreeSection({
  section,
  sectionIndex,
  completedSuggestionIds,
  onApplySuggestion,
}: {
  section: DailyBrief["sections"][number],
  sectionIndex: number,
  completedSuggestionIds: Set<string>,
  onApplySuggestion: (suggestionId: string) => void,
}) {
  return (
    <section className="relative grid grid-cols-[2.25rem_1fr] gap-3">
      <div aria-hidden className="relative flex justify-center">
        <div className="absolute bottom-[-1.5rem] top-7 w-px bg-foreground/[0.12]" />
        <div className="relative z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10 text-xs font-bold text-purple-700 ring-1 ring-purple-500/20 dark:text-purple-300">
          +
        </div>
      </div>
      <div className="min-w-0 pb-5">
        <div className="mb-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-700 dark:text-purple-300">
              Section {sectionIndex + 1}
            </span>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              {section.heading}
            </h3>
          </div>
          {section.intro != null && (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {section.intro}
            </p>
          )}
        </div>
        <div className="space-y-4 pl-3">
          {section.blocks.map((block, index) => (
            <DailyBriefBlockRenderer
              key={`${section.heading}-${index}`}
              block={block}
              completedSuggestionIds={completedSuggestionIds}
              onApplySuggestion={onApplySuggestion}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BriefTree({
  brief,
  completedSuggestionIds,
  onApplySuggestion,
}: {
  brief: DailyBrief,
  completedSuggestionIds: Set<string>,
  onApplySuggestion: (suggestionId: string) => void,
}) {
  return (
    <article className="space-y-1">
      <header className="grid grid-cols-[2.25rem_1fr] gap-3">
        <div aria-hidden className="relative flex justify-center">
          <div className="absolute top-8 h-5 w-px bg-foreground/[0.12]" />
          <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
            <SparkleIcon className="h-4 w-4" weight="fill" />
          </div>
        </div>
        <div className="min-w-0 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{brief.dayLabel}</span>
            <span aria-hidden>/</span>
            <span>{brief.readTime}</span>
          </div>
          <h2 className="mt-1 max-w-4xl text-2xl font-semibold tracking-tight text-foreground">
            {brief.title}
          </h2>
        </div>
      </header>

      {brief.sections.map((section, sectionIndex) => (
        <BriefTreeSection
          key={section.heading}
          section={section}
          sectionIndex={sectionIndex}
          completedSuggestionIds={completedSuggestionIds}
          onApplySuggestion={onApplySuggestion}
        />
      ))}
    </article>
  );
}

export default function PageClient() {
  const allSuggestions = useMemo(() => getAllDailyBriefSuggestions(), []);
  const [completedSuggestionIds, setCompletedSuggestionIds] = useState<Set<string>>(() => new Set());
  const [enabledBriefDays, setEnabledBriefDays] = useState<Set<WeekdayId>>(() => new Set(["mon", "tue", "wed", "thu", "fri"]));
  const completedCount = allSuggestions.filter((suggestion) => completedSuggestionIds.has(suggestion.id)).length;
  const allSuggestionsCompleted = allSuggestions.length > 0 && completedCount === allSuggestions.length;
  const enabledDayLabel = WEEKDAYS.filter((day) => enabledBriefDays.has(day.id)).map((day) => day.label).join(", ");

  const applySuggestion = (suggestionId: string) => {
    setCompletedSuggestionIds((previous) => {
      const next = new Set(previous);
      next.add(suggestionId);
      return next;
    });
  };

  const applyAllSuggestions = () => {
    setCompletedSuggestionIds(new Set(allSuggestions.map((suggestion) => suggestion.id)));
  };

  const toggleBriefDay = (dayId: WeekdayId, enabled: boolean) => {
    setEnabledBriefDays((previous) => {
      const next = new Set(previous);
      if (enabled) {
        next.add(dayId);
      } else {
        next.delete(dayId);
      }
      return next;
    });
  };

  return (
    <PageLayout
      title="Daily Brief"
      description="Short daily notes for Demo Project. Mock data only for the team presentation."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <DesignBadge
            label={`${completedCount}/${allSuggestions.length} completed`}
            color={allSuggestionsCompleted ? "green" : "blue"}
            icon={allSuggestionsCompleted ? CheckCircleIcon : LightningIcon}
            size="sm"
          />
          <DesignButton
            size="sm"
            onClick={applyAllSuggestions}
            disabled={allSuggestionsCompleted}
            variant={allSuggestionsCompleted ? "secondary" : "default"}
            className={cn(
              "transition-all duration-150 hover:transition-none",
              allSuggestionsCompleted && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {allSuggestionsCompleted ? <CheckCircleIcon className="h-3.5 w-3.5" weight="fill" /> : null}
              {allSuggestionsCompleted ? "All suggestions completed" : "Apply all suggestions"}
            </span>
          </DesignButton>
          <DesignDialog
            trigger={
              <DesignButton variant="outline" size="icon" aria-label="Configure Daily Brief schedule">
                <GearIcon className="h-4 w-4" />
              </DesignButton>
            }
            icon={GearIcon}
            title="Daily Brief schedule"
            description="Choose which days should create a new brief. This is mock UI for now."
            size="md"
            footer={
              <DesignDialogClose asChild>
                <DesignButton size="sm">Done</DesignButton>
              </DesignDialogClose>
            }
          >
            <div className="space-y-4">
              <div className="rounded-2xl bg-foreground/[0.04] p-3 text-sm text-muted-foreground ring-1 ring-foreground/[0.08]">
                Current schedule: <span className="font-medium text-foreground">{enabledDayLabel || "No days selected"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEKDAYS.map((day) => (
                  <label
                    key={day.id}
                    className="flex cursor-pointer items-center gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2 text-sm font-medium text-foreground ring-1 ring-foreground/[0.08] transition-colors duration-150 hover:bg-foreground/[0.06] hover:transition-none"
                  >
                    <Checkbox
                      checked={enabledBriefDays.has(day.id)}
                      onCheckedChange={(checked) => toggleBriefDay(day.id, checked === true)}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
          </DesignDialog>
        </div>
      }
      fillWidth
      wrapHeaderInCard
    >
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <DesignCard title="Archive" icon={SparkleIcon} gradient="purple" contentClassName="space-y-2">
          {DAILY_BRIEFS.map((brief) => {
            const suggestionCount = brief.sections.flatMap((section) => section.blocks.filter((block) => block.type === "suggestion")).length;
            const suggestionLabel = `${suggestionCount} suggested ${suggestionCount === 1 ? "action" : "actions"}`;
            return (
              <a
                key={brief.id}
                href={`#${brief.id}`}
                className="block rounded-xl p-3 transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/[0.16]"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-foreground">{brief.dayLabel}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{brief.readTime}</span>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {brief.title}
                </p>
                {suggestionCount > 0 && (
                  <div className="mt-2 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                    {suggestionLabel}
                  </div>
                )}
              </a>
            );
          })}
        </DesignCard>

        <div className="space-y-4">
          {DAILY_BRIEFS.map((brief) => (
            <DesignCard
              key={brief.id}
              id={brief.id}
              title={brief.dateLabel}
              subtitle={brief.summary}
              icon={SparkleIcon}
              gradient="purple"
              actions={
                <div className="flex flex-wrap justify-end gap-1.5">
                  {brief.tags.map((tag) => (
                    <DesignBadge key={tag} label={tag} color="purple" size="sm" />
                  ))}
                </div>
              }
              contentClassName="space-y-6"
            >
              <BriefTree
                brief={brief}
                completedSuggestionIds={completedSuggestionIds}
                onApplySuggestion={applySuggestion}
              />
            </DesignCard>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
