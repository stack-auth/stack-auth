import { getGrowthPhase, type GrowthPhase } from "./growth-status";
import type { GrowthStatus } from "./growth-types";

/**
 * Whether the Growth admin workspace may edit the customer-facing content, and if not, what the
 * project is still waiting on.
 *
 * The admin page renders the customer's workspace with every field editable, which only makes sense
 * once the pipeline has produced something to edit: before the interview is answered the findings,
 * notes and actions either don't exist yet (deep research still running) or are still being reshaped
 * by the interview answers, so editing them is at best pointless and at worst overwritten by the
 * run. Until then the workspace is read-only and the interview — the one human gate that unblocks
 * everything downstream — is the only thing staff can act on.
 */
export type GrowthAdminEditGate = {
  phase: GrowthPhase,
  /** Findings, notes, actions, stage scores and authored stage pages. */
  contentEditable: boolean,
  /** Null exactly when `contentEditable` is true. Phrased in terms of what the customer is waiting on. */
  blockedReason: string | null,
};

/**
 * Keyed by the phases that precede a published report — i.e. this map's key set IS the definition of
 * "too early to edit". `report-ready` and `steady-state` are deliberately absent.
 */
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
