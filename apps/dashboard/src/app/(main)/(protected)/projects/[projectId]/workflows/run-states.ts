import type { DesignBadgeColor } from "@hexclave/dashboard-ui-components";
import type { AdminWorkflowRunState, AdminWorkflowTrigger } from "@hexclave/next";

// Display helpers for workflow run states and triggers. There is
// deliberately NO "paused" state: divergent upgrade transfers are skipped
// (the run keeps executing its pinned version) and surface as diagnostics on
// upgradeRuns responses instead.

export type RunState = AdminWorkflowRunState;

export const ALL_RUN_STATES: RunState[] = ["queued", "running", "sleeping", "failed", "completed", "canceled"];

export const RUN_STATE_LABELS = new Map<RunState, string>([
  ["queued", "Queued"],
  ["running", "Running"],
  ["sleeping", "Sleeping"],
  ["failed", "Failed"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
]);

export const RUN_STATE_BADGE_COLORS = new Map<RunState, DesignBadgeColor>([
  ["queued", "cyan"],
  ["running", "blue"],
  ["sleeping", "purple"],
  ["failed", "red"],
  ["completed", "green"],
  // No neutral badge color exists in the design system; canceled reuses cyan
  // and relies on its icon/label to disambiguate from queued.
  ["canceled", "cyan"],
]);

export function getRunStateLabel(state: RunState): string {
  return RUN_STATE_LABELS.get(state) ?? state;
}

export function getRunStateBadgeColor(state: RunState): DesignBadgeColor {
  return RUN_STATE_BADGE_COLORS.get(state) ?? "blue";
}

export function getTriggerKind(trigger: AdminWorkflowTrigger): "platform" | "custom" | "schedule" {
  if (trigger.type === "schedule") return "schedule";
  return trigger.eventType.startsWith("custom.") ? "custom" : "platform";
}

export function getTriggerLabel(trigger: AdminWorkflowTrigger): string {
  if (trigger.type === "schedule") return `${trigger.cron} · ${trigger.timezone}`;
  return trigger.eventType;
}

export function getWorkflowFileName(workflowId: string): string {
  return `workflows/${workflowId}.ts`;
}
