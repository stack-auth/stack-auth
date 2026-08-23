"use client";

import { DesignAlert, DesignBadge, DesignCard } from "@/components/design-components";
import { cn } from "@/components/ui";
import { formatGrowthRelativeTime } from "@/lib/growth/growth-format";
import type { GrowthAdminEditGate } from "@/lib/growth/growth-admin-lifecycle";
import type { GrowthPhase } from "@/lib/growth/growth-status";
import { getGrowthTimelineStepStates, GROWTH_TIMELINE_STEP_IDS, type GrowthTimelineStepId, type GrowthTimelineStepState } from "@/lib/growth/growth-timeline";
import type { GrowthStatus } from "@/lib/growth/growth-types";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { CheckCircleIcon, CircleIcon, CircleNotchIcon, PulseIcon, WarningCircleIcon } from "@phosphor-icons/react";

/**
 * Where the selected customer is in their Growth lifecycle, at the top of the admin workspace.
 *
 * The point is to answer "is there anything here worth editing yet?" before staff start editing:
 * the workspace below renders the customer's findings, notes and actions, all of which only exist
 * once deep research has run and the interview has been answered. Step states come from
 * `getGrowthTimelineStepStates` — the same derivation the customer's own timeline uses — so the two
 * surfaces can never disagree about which phase a project is in. Presentation differs on purpose:
 * this is one dense row for a pro user, not the customer's expanded, navigable timeline. It is also
 * deliberately read-only; the customer timeline's controls (onboarding form, restart, retry) act on
 * the app the page is mounted in, which here is the internal project, not the customer's.
 */

const PHASE_LABELS = new Map<GrowthPhase, string>([
  ["not-onboarded", "Not onboarded"],
  ["analyzing", "Deep research running"],
  ["analysis-failed", "Deep research failed"],
  ["interview", "Waiting on interview"],
  ["report-ready", "Report ready"],
  ["steady-state", "Ongoing"],
]);

const PHASE_COLORS = new Map<GrowthPhase, "orange" | "cyan" | "red" | "green">([
  ["not-onboarded", "orange"],
  ["analyzing", "cyan"],
  ["analysis-failed", "red"],
  ["interview", "orange"],
  ["report-ready", "green"],
  ["steady-state", "green"],
]);

const STEP_LABELS = new Map<GrowthTimelineStepId, string>([
  ["set-up", "Set up"],
  ["compute-metrics", "Metrics"],
  ["integrations", "Integrations"],
  ["analysis", "Deep research"],
  ["interview", "Interview"],
  ["report", "Report"],
  ["ongoing", "Ongoing"],
]);

/** Named from staff's point of view: what the interview's wire state means for whoever is looking at it. */
const INTERVIEW_LABELS = new Map<GrowthStatus["interview"]["state"], string>([
  ["not_ready", "not generated yet"],
  ["preparing", "held for staff review"],
  ["ready", "released, not started"],
  ["in_progress", "in progress"],
  ["completed", "completed"],
]);

function StepChip(props: { label: string, state: GrowthTimelineStepState }) {
  const icon = new Map<GrowthTimelineStepState, React.ReactNode>([
    ["done", <CheckCircleIcon key="done" weight="fill" className="size-3.5 text-emerald-600 dark:text-emerald-400" />],
    ["current", <CircleNotchIcon key="current" className="size-3.5 animate-spin text-cyan-600 dark:text-cyan-400" />],
    ["failed", <WarningCircleIcon key="failed" weight="fill" className="size-3.5 text-destructive" />],
    ["upcoming", <CircleIcon key="upcoming" className="size-3.5 text-muted-foreground/40" />],
  ]).get(props.state);
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", props.state === "upcoming" && "text-muted-foreground/60")}>
      {icon}
      {props.label}
    </span>
  );
}

/** The one or two facts that explain the phase, so staff don't have to open the ops cards to learn them. */
function detailLines(status: GrowthStatus, nowMillis: number): string[] {
  const lines: string[] = [];
  if (status.onboarding.completed && status.onboarding.completedAtMillis != null) {
    lines.push(`Onboarded ${formatGrowthRelativeTime(status.onboarding.completedAtMillis, nowMillis)}`);
  }
  if (status.analysis.state === "failed" && status.analysis.errorMessage != null) {
    lines.push(`Deep research error: ${status.analysis.errorMessage}`);
  }
  if (status.interview.state !== "completed") {
    const label = INTERVIEW_LABELS.get(status.interview.state) ?? throwErr(`INTERVIEW_LABELS is missing an entry for interview state ${status.interview.state}`);
    lines.push(`Interview ${label} — ${status.interview.answeredCount}/${status.interview.estimatedTotal} answered`);
  }
  lines.push(status.latestReport == null ? "No report published yet" : `Report published ${formatGrowthRelativeTime(status.latestReport.createdAtMillis, nowMillis)}`);
  return lines;
}

export function GrowthAdminLifecycleCard(props: { status: GrowthStatus, gate: GrowthAdminEditGate, nowMillis: number }) {
  const steps = getGrowthTimelineStepStates(props.status);
  return (
    <DesignCard title="Customer lifecycle" icon={PulseIcon}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DesignBadge
            label={PHASE_LABELS.get(props.gate.phase) ?? throwErr(`PHASE_LABELS is missing an entry for growth phase ${props.gate.phase}`)}
            color={PHASE_COLORS.get(props.gate.phase) ?? throwErr(`PHASE_COLORS is missing an entry for growth phase ${props.gate.phase}`)}
            size="sm"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{props.gate.phase}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {GROWTH_TIMELINE_STEP_IDS.map((stepId) => {
            const state = steps.get(stepId) ?? throwErr(`getGrowthTimelineStepStates returned no state for step ${stepId}`);
            // "hidden" is how the derivation says a run predates a phase; the customer's timeline
            // omits those rows, and so does this one.
            if (state === "hidden") return null;
            return <StepChip key={stepId} label={STEP_LABELS.get(stepId) ?? throwErr(`STEP_LABELS is missing an entry for timeline step ${stepId}`)} state={state} />;
          })}
        </div>
        <div className="space-y-0.5">
          {detailLines(props.status, props.nowMillis).map((line) => (
            <p key={line} className="text-xs text-muted-foreground">{line}</p>
          ))}
        </div>
        {props.gate.blockedReason != null && (
          <DesignAlert variant="warning" title="The workspace below is read-only">
            {props.gate.blockedReason}
          </DesignAlert>
        )}
      </div>
    </DesignCard>
  );
}
