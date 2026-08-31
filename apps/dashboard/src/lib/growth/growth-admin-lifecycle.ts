import { getGrowthPhase, type GrowthPhase } from "./growth-status";
import type { GrowthStatus } from "./growth-types";

export type GrowthAdminEditGate = {
  phase: GrowthPhase,
  contentEditable: boolean,
  blockedReason: string | null,
};

const BLOCKED_REASONS = new Map<GrowthPhase, string>([
  ["not-onboarded", "This project hasn't onboarded yet, so there is no research, no metrics and nothing to edit."],
  ["analyzing", "Deep research is still running. The findings, notes and actions it produces don't exist yet."],
  ["analysis-failed", "Deep research failed, so it produced no findings, notes or actions. Re-run it under lifecycle operations."],
  ["interview", "Deep research is done, but the customer hasn't finished the interview — the findings and actions it feeds are not final yet. Review and release the interview first."],
]);

export function getGrowthAdminEditGate(status: GrowthStatus): GrowthAdminEditGate {
  const phase = getGrowthPhase(status);
  const blockedReason = BLOCKED_REASONS.get(phase) ?? null;
  return { phase, contentEditable: blockedReason == null, blockedReason };
}
