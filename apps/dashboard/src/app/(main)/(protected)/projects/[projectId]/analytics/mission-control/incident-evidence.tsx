"use client";

import {
  DesignAlert,
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
} from "@/components/design-components";
import {
  ArrowRightIcon,
  BrowserIcon,
  BugIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CursorClickIcon,
  FlagIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  LightbulbFilamentIcon,
  PulseIcon,
  RobotIcon,
  SparkleIcon,
  TrendDownIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type { IncidentStory, MetricUnit } from "./stories";

export type IncidentEvidenceProps = {
  story: IncidentStory,
  activeStageIndex: number,
  selectedRemediationId: string | null,
  onSelectRemediation: (id: string) => void,
};

type EvidenceDetail = {
  id: string,
  label: string,
  detail: string,
  strength: string,
};

type ReplayFrame = {
  id: string,
  caption: string,
  action: string,
  url: string,
  cursorX: number,
  cursorY: number,
  severity: string,
};

type MetricComparison = {
  id: string,
  label: string,
  before: string,
  during: string,
  recovered: string,
};

type RemediationChoice = {
  id: string,
  title: string,
  description: string,
  recovery: string,
  risk: string,
  recommended: boolean,
};

function toPercent(value: number): string {
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.round(percent)}%`;
}

function storyDisplayName(story: IncidentStory): string {
  return story.title;
}

function buildReplayFrames(story: IncidentStory): readonly ReplayFrame[] {
  if (story.replayFrames.length === 0) {
    return [
      {
        id: "fallback-replay",
        caption: "User retries the blocked action after the interface stops responding.",
        action: "Repeated click detected",
        url: "/checkout/confirm",
        cursorX: 68,
        cursorY: 66,
        severity: "error",
      },
    ];
  }

  return story.replayFrames.map((frame) => ({
    id: frame.id,
    caption: frame.description,
    action: frame.title,
    url: frame.route,
    cursorX: Math.min(92, Math.max(8, frame.cursorX)),
    cursorY: Math.min(88, Math.max(12, frame.cursorY)),
    severity: frame.highlightedSelector == null ? "warning" : "error",
  }));
}

function buildEvidence(story: IncidentStory): readonly EvidenceDetail[] {
  if (story.rootCauseEvidence.length === 0) {
    return [
      { id: "release", label: "Release boundary", detail: "Error onset aligns with the latest production change.", strength: "Strong" },
      { id: "cohort", label: "Affected cohort", detail: "Failures concentrate in one client and action path.", strength: "Strong" },
      { id: "trace", label: "Trace signature", detail: "Healthy requests diverge at the same operation.", strength: "Moderate" },
    ];
  }

  return story.rootCauseEvidence.map((row) => ({
    id: row.id,
    label: row.signal,
    detail: row.explanation,
    strength: row.confidence >= 0.9 ? "Strong" : row.confidence >= 0.75 ? "Moderate" : "Supporting",
  }));
}

function formatIncidentMetric(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "percent": {
      return `${value.toFixed(value < 10 ? 2 : 1)}%`;
    }
    case "milliseconds": {
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
    }
    case "count": {
      return Math.round(value).toLocaleString();
    }
    case "requests-per-minute": {
      return `${Math.round(value).toLocaleString()} rpm`;
    }
    case "dollars": {
      return `$${Math.round(value).toLocaleString()}`;
    }
    default: {
      const exhaustiveUnit: never = unit;
      return exhaustiveUnit;
    }
  }
}

function buildMetrics(story: IncidentStory): readonly MetricComparison[] {
  if (story.metrics.length === 0) {
    return [
      { id: "success", label: "Success rate", before: "99.4%", during: "71.8%", recovered: "99.2%" },
      { id: "latency", label: "p95 latency", before: "420 ms", during: "4.8 s", recovered: "460 ms" },
      { id: "users", label: "Affected users", before: "0", during: "2,847", recovered: "12" },
    ];
  }

  return story.metrics.slice(0, 4).map((metric) => ({
    id: metric.id,
    label: metric.label,
    before: formatIncidentMetric(metric.baseline, metric.unit),
    during: formatIncidentMetric(metric.current, metric.unit),
    recovered: formatIncidentMetric(metric.recovered, metric.unit),
  }));
}

function buildRemediations(story: IncidentStory): readonly RemediationChoice[] {
  if (story.remediationActions.length === 0) {
    return [
      {
        id: "rollback",
        title: "Rollback implicated change",
        description: "Restore the last known-good production behavior.",
        recovery: "~8 min",
        risk: "Low",
        recommended: true,
      },
      {
        id: "disable-flag",
        title: "Disable affected feature flag",
        description: "Contain impact for the affected cohort while preserving the release.",
        recovery: "~3 min",
        risk: "Low",
        recommended: false,
      },
    ];
  }

  return story.remediationActions.map((remediation, index) => ({
    id: remediation.id,
    title: remediation.title,
    description: remediation.details,
    recovery: remediation.status === "completed" ? "Recovered" : remediation.status === "in-progress" ? "~5 min" : "~15 min",
    risk: index === 0 ? "Low" : "Medium",
    recommended: index === 0,
  }));
}

function strengthColor(strength: string): "green" | "orange" | "blue" {
  const normalized = strength.toLowerCase();
  if (normalized.includes("strong") || normalized.includes("high")) return "green";
  if (normalized.includes("weak") || normalized.includes("low")) return "orange";
  return "blue";
}

function SessionReplay({
  story,
  activeStageIndex,
}: {
  story: IncidentStory,
  activeStageIndex: number,
}) {
  const reducedMotion = useReducedMotion();
  const frames = useMemo(() => buildReplayFrames(story), [story]);
  const activeStage = story.stages.at(Math.min(activeStageIndex, story.stages.length - 1));
  const stageFrame = activeStage == null
    ? undefined
    : frames.find((candidate) => story.replayFrames.find((source) => source.id === candidate.id)?.stageId === activeStage.id);
  const frame = stageFrame ?? frames[Math.min(activeStageIndex, frames.length - 1)];
  const isRageClick = frame.action.toLowerCase().includes("click") || frame.severity.toLowerCase().includes("error");

  return (
    <DesignAnalyticsCard gradient="cyan" className="overflow-hidden">
      <DesignAnalyticsCardHeader
        label="User-impact replay"
        right={<DesignBadge label={`Stage ${activeStageIndex + 1}`} color="cyan" size="sm" />}
      />
      <div className="p-4">
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="flex h-8 items-center gap-2 border-b border-border bg-foreground/[0.03] px-3">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="size-2 rounded-full bg-red-500/70" />
              <span className="size-2 rounded-full bg-orange-500/70" />
              <span className="size-2 rounded-full bg-emerald-500/70" />
            </div>
            <div className="min-w-0 flex-1 truncate rounded-md bg-foreground/[0.05] px-2 py-1 text-[10px] text-muted-foreground">
              {frame.url}
            </div>
          </div>
          <div className="relative h-44 overflow-hidden bg-gradient-to-br from-background via-background to-cyan-500/[0.05]">
            <div className="absolute inset-x-5 top-5 h-8 rounded-lg bg-foreground/[0.05]" />
            <div className="absolute left-5 right-[42%] top-16 h-3 rounded bg-foreground/[0.08]" />
            <div className="absolute left-5 right-[58%] top-24 h-3 rounded bg-foreground/[0.05]" />
            <div className="absolute bottom-5 right-5 rounded-lg bg-cyan-500/15 px-5 py-2 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
              Confirm action
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={frame.id}
                className="absolute"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.75 }}
                animate={{ opacity: 1, scale: 1, left: `${frame.cursorX}%`, top: `${frame.cursorY}%` }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.22 }}
              >
                {isRageClick && !reducedMotion && (
                  <>
                    <motion.span
                      className="absolute -left-3 -top-3 size-7 rounded-full border border-red-500/70"
                      animate={{ opacity: [0.8, 0], scale: [0.5, 1.8] }}
                      transition={{ duration: 0.7, repeat: Infinity }}
                    />
                    <motion.span
                      className="absolute -left-3 -top-3 size-7 rounded-full border border-red-500/50"
                      animate={{ opacity: [0.7, 0], scale: [0.5, 2.2] }}
                      transition={{ duration: 0.7, delay: 0.2, repeat: Infinity }}
                    />
                  </>
                )}
                <CursorClickIcon className="relative size-6 -rotate-12 text-red-500 drop-shadow-sm" weight="fill" />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-start gap-3 border-t border-border bg-foreground/[0.02] px-3 py-2.5">
            <PulseIcon className="mt-0.5 size-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{frame.action}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{frame.caption}</p>
            </div>
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

function ImpactMetrics({ story }: { story: IncidentStory }) {
  const metrics = useMemo(() => buildMetrics(story), [story]);
  const impact = `${story.userImpact} ${story.businessImpact}`;

  return (
    <DesignAnalyticsCard gradient="orange">
      <DesignAnalyticsCardHeader label="Before / incident / recovered" />
      <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Signal</span><span>Before</span><span>Incident</span><span>Projected</span>
      </div>
      <div className="divide-y divide-border">
        {metrics.map((metric) => (
          <div key={metric.id} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] items-center px-4 py-2.5 text-xs tabular-nums">
            <span className="truncate font-medium text-foreground">{metric.label}</span>
            <span className="text-muted-foreground">{metric.before}</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{metric.during}</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{metric.recovered}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 px-4 py-3 text-xs text-muted-foreground">
        <TrendDownIcon className="mt-0.5 size-4 shrink-0 text-orange-500" />
        <span>{impact}</span>
      </div>
    </DesignAnalyticsCard>
  );
}

export function IncidentEvidence({
  story,
  activeStageIndex,
  selectedRemediationId,
  onSelectRemediation,
}: IncidentEvidenceProps) {
  const reducedMotion = useReducedMotion();
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetail | null>(null);
  const evidence = useMemo(() => buildEvidence(story), [story]);
  const remediations = useMemo(() => buildRemediations(story), [story]);

  const confidence = story.rootCauseEvidence.length === 0
    ? 0.92
    : story.rootCauseEvidence.reduce((sum, item) => sum + item.confidence, 0) / story.rootCauseEvidence.length;
  const rootCause = story.rootCauseEvidence.map((item) => item.explanation).join(" ");
  const release = `${story.change.deployment.version} · ${story.change.deployment.service}`;
  const configChange = story.change.configChanges.at(0);
  const change = configChange == null
    ? story.suspect.commitTitle
    : `${configChange.key}: ${configChange.previousValue} → ${configChange.nextValue}`;
  const featureFlag = story.change.featureFlags.at(0);
  const flag = featureFlag == null
    ? "No feature flag changed"
    : `${featureFlag.key} · ${featureFlag.rolloutPercent}% rollout`;
  const commit = story.suspect.commitSha;
  const pullRequest = `#${story.suspect.pullRequestNumber} · ${story.suspect.pullRequestTitle}`;
  const author = story.suspect.author;
  const owner = story.suspect.owner;
  const changedLines = story.suspect.changedLines;
  const timeline = story.stages;
  const selectedRemediation = remediations.find((item) => item.id === selectedRemediationId) ?? null;
  const generatedFix = selectedRemediation == null || changedLines.length === 0
    ? ""
    : [
      `// Generated remediation preview: ${selectedRemediation.title}`,
      ...changedLines.map((line) => `// ${line.file}:${line.startLine}-${line.endLine}\n// ${line.summary}`),
    ].join("\n");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <SessionReplay story={story} activeStageIndex={activeStageIndex} />
        <DesignCard title="AI root-cause brief" subtitle={storyDisplayName(story)} icon={RobotIcon} gradient="purple">
          <div className="space-y-4">
            <DesignAlert
              variant="warning"
              title={`${toPercent(confidence)} confidence`}
              description={rootCause}
              glassmorphic
            />
            <div className="space-y-2">
              {evidence.map((row, index) => (
                <motion.button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-foreground/[0.025] p-3 text-left transition-colors duration-150 hover:bg-foreground/[0.055] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  onClick={() => setSelectedEvidence(row)}
                  initial={reducedMotion ? false : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.18, delay: reducedMotion ? 0 : index * 0.035 }}
                >
                  <CheckCircleIcon className="size-4 shrink-0 text-emerald-500" weight="fill" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">{row.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.detail}</span>
                  </span>
                  <DesignBadge label={row.strength} color={strengthColor(row.strength)} size="sm" />
                  <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </motion.button>
              ))}
            </div>
          </div>
        </DesignCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DesignCard title="Correlated change" icon={FlagIcon} gradient="orange">
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Release</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{release}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Change</p>
              <p className="mt-1 text-xs leading-5 text-foreground">{change}</p>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-orange-500/[0.08] px-3 py-2">
              <span className="text-xs font-medium text-foreground">{flag}</span>
              <DesignBadge label="Correlated" color="orange" size="sm" />
            </div>
          </div>
        </DesignCard>

        <DesignCard title="Suspect ownership" icon={GitCommitIcon} gradient="default">
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground"><GitCommitIcon className="size-4" />Commit</span>
              <code className="font-semibold text-foreground">{commit}</code>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground"><GitPullRequestIcon className="size-4" />Pull request</span>
              <span className="font-semibold text-foreground">{pullRequest}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground"><UserCircleIcon className="size-4" />Author</span>
              <span className="font-semibold text-foreground">{author}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground"><BugIcon className="size-4" />CODEOWNERS</span>
              <span className="font-semibold text-foreground">{owner}</span>
            </div>
          </div>
        </DesignCard>

        <DesignCard title="Changed-line diff" icon={CodeIcon} gradient="default" contentClassName="p-0">
          <div className="max-h-44 overflow-auto bg-foreground/[0.025] py-2 font-mono text-[10px] leading-5">
            {(changedLines.length > 0 ? changedLines.slice(0, 8) : [
              "- previousBehavior(input)",
              "+ guardedBehavior(input, cohort)",
              "+ emitTelemetry(\"decision\")",
            ]).map((line, index) => {
              const content = typeof line === "string"
                ? line
                : `~ ${line.file}:${line.startLine}-${line.endLine} ${line.summary}`;
              const addition = content.trimStart().startsWith("+");
              const removal = content.trimStart().startsWith("-");
              return (
                <div
                  key={`${index}-${content}`}
                  className={addition ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : removal ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground"}
                >
                  <span className="inline-block w-8 select-none pr-2 text-right text-muted-foreground/60">{index + 1}</span>
                  {content}
                </div>
              );
            })}
          </div>
        </DesignCard>
      </div>

      <ImpactMetrics story={story} />

      <DesignCard title="Recovery options" subtitle="Selection only — no production mutation is performed" icon={LightbulbFilamentIcon} gradient="green">
        <div className="grid gap-3 lg:grid-cols-3">
          {remediations.map((remediation) => {
            const selected = remediation.id === selectedRemediationId;
            return (
              <div
                key={remediation.id}
                className={`flex min-h-44 flex-col rounded-xl border p-3 transition-colors duration-150 hover:transition-none ${
                  selected ? "border-emerald-500/60 bg-emerald-500/[0.08]" : "border-border bg-foreground/[0.025] hover:bg-foreground/[0.05]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{remediation.title}</p>
                  {remediation.recommended && <DesignBadge label="Recommended" color="green" size="sm" />}
                </div>
                <p className="mt-2 flex-1 text-xs leading-5 text-muted-foreground">{remediation.description}</p>
                <div className="mb-3 mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ClockCounterClockwiseIcon className="size-4 text-emerald-500" />
                  <span>{remediation.recovery} projected</span>
                  <span>·</span>
                  <span>{remediation.risk} risk</span>
                </div>
                <DesignButton
                  size="sm"
                  variant={selected ? "secondary" : remediation.recommended ? "default" : "outline"}
                  onClick={() => onSelectRemediation(remediation.id)}
                >
                  {selected ? "Selected for review" : "Select action"}
                </DesignButton>
              </div>
            );
          })}
        </div>
        {generatedFix.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border bg-foreground/[0.03] px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <SparkleIcon className="size-4 text-purple-500" weight="fill" />
                Generated fix preview
              </span>
              <DesignBadge label="Preview only" color="purple" size="sm" />
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-5 text-muted-foreground">{generatedFix}</pre>
          </div>
        )}
      </DesignCard>

      <DesignCard title="Incident timeline & postmortem evidence" icon={ClockCounterClockwiseIcon} gradient="cyan">
        <div className="relative space-y-1 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-border">
          {(timeline.length > 0 ? timeline : [
            { title: "Release completed", description: "Production change reaches the affected cohort." },
            { title: "Impact detected", description: "User outcome and service signals cross alert thresholds." },
            { title: "Cause isolated", description: "Replay, traces, and release evidence converge." },
            { title: "Recovery projected", description: "Selected containment restores the baseline path." },
          ]).map((event, index) => {
            const title = event.title;
            const description = "summary" in event ? event.summary : event.description;
            const active = index === Math.min(activeStageIndex, timeline.length > 0 ? timeline.length - 1 : 3);
            return (
              <motion.div
                key={`${index}-${title}`}
                className="relative flex gap-3 py-2"
                animate={{ opacity: index <= activeStageIndex ? 1 : 0.48 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
              >
                <span className={`relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-background ${active ? "bg-cyan-500 ring-4 ring-cyan-500/15" : index < activeStageIndex ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <div>
                  <p className="text-xs font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </DesignCard>

      <DesignDialog
        open={selectedEvidence != null}
        onOpenChange={(open) => {
          if (!open) setSelectedEvidence(null);
        }}
        size="md"
        icon={BrowserIcon}
        title={selectedEvidence?.label ?? "Evidence detail"}
        description="Read-only incident evidence used by the root-cause model."
        footer={
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Close</DesignButton>
          </DesignDialogClose>
        }
      >
        <div className="space-y-3">
          <DesignAlert
            variant="info"
            title={selectedEvidence?.strength ?? "Evidence"}
            description={selectedEvidence?.detail ?? "No evidence selected."}
            glassmorphic
          />
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <WarningCircleIcon className="size-4" />
            Correlation supports diagnosis but does not independently prove causation.
          </p>
        </div>
      </DesignDialog>
    </div>
  );
}
