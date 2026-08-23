import type { Tenancy } from "@/lib/tenancies";
import { syncWorkflowSource } from "@/lib/workflows/api";
import { globalPrismaClient } from "@/prisma-client";
import { WORKFLOW_CUSTOM_EVENT_PREFIX } from "@hexclave/shared/dist/interface/workflows";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  GROWTH_ANALYSIS_RUN_ACTIVATED_EVENT_NAME,
  GROWTH_ANALYSIS_WORKFLOW_ID,
  GROWTH_ANALYSIS_WORKFLOW_SOURCE,
  GROWTH_DAILY_BRIEF_DUE_EVENT_NAME,
  GROWTH_DAILY_BRIEF_WORKFLOW_ID,
  GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE,
  GROWTH_INTERVIEW_FINISHED_EVENT_NAME,
  getGrowthAnalysisLegRunKey,
} from "./workflow-sources";

/**
 * Seeding + drift detection for the two canonical Growth workflows. Growth
 * seeds these as ordinary customer workflows (the customer may edit or delete
 * them freely); Growth NEVER auto-updates an existing definition. The only
 * write paths are:
 *   - ensureGrowthWorkflows: recreate a MISSING definition (onboarding + the
 *     watchdog's ensure pass), and
 *   - restoreGrowthWorkflow: an explicit admin request to reset one back to
 *     the canonical source.
 */

/** Wire event types of the Growth boundary events — never use magic strings. */
export const GROWTH_EVENT_TYPES = {
  analysisRunActivated: `${WORKFLOW_CUSTOM_EVENT_PREFIX}${GROWTH_ANALYSIS_RUN_ACTIVATED_EVENT_NAME}`,
  interviewFinished: `${WORKFLOW_CUSTOM_EVENT_PREFIX}${GROWTH_INTERVIEW_FINISHED_EVENT_NAME}`,
  dailyBriefDue: `${WORKFLOW_CUSTOM_EVENT_PREFIX}${GROWTH_DAILY_BRIEF_DUE_EVENT_NAME}`,
} as const;

/**
 * Both leg runKeys of one analysis run, matching the source's runKey function.
 *
 * Lives here, next to `GROWTH_EVENT_TYPES` it is derived from, rather than in watchdog.ts where it
 * started. The move is load-bearing, not cosmetic: `dashboard.ts` needs this helper, and the ad
 * platform integration gives watchdog.ts a sub-step that reaches into a spend-capable write seam —
 * so leaving it in watchdog.ts would make that seam reachable from every route tree that touches the
 * growth dashboard helpers, which is an architectural error. Nothing should import watchdog.ts
 * except the cron route.
 */
export function getGrowthAnalysisLegRunKeys(growthRunId: string): string[] {
  return [
    getGrowthAnalysisLegRunKey(growthRunId, GROWTH_EVENT_TYPES.analysisRunActivated),
    getGrowthAnalysisLegRunKey(growthRunId, GROWTH_EVENT_TYPES.interviewFinished),
  ];
}

export type GrowthWorkflowDefinitionSpec = {
  source: string,
  displayName: string,
};

export const GROWTH_WORKFLOW_DEFINITIONS: ReadonlyMap<string, GrowthWorkflowDefinitionSpec> = new Map([
  [GROWTH_ANALYSIS_WORKFLOW_ID, { source: GROWTH_ANALYSIS_WORKFLOW_SOURCE, displayName: "Growth: Analysis Runner" }],
  [GROWTH_DAILY_BRIEF_WORKFLOW_ID, { source: GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE, displayName: "Growth: Daily Brief" }],
]);

export const GROWTH_WORKFLOW_IDS = [...GROWTH_WORKFLOW_DEFINITIONS.keys()];

function getGrowthWorkflowSpec(workflowId: string): GrowthWorkflowDefinitionSpec {
  return GROWTH_WORKFLOW_DEFINITIONS.get(workflowId)
    ?? throwErr(`"${workflowId}" is not a canonical Growth workflow id (expected one of: ${GROWTH_WORKFLOW_IDS.join(", ")})`);
}

/**
 * Pure edit-detection: a stored source is "edited" iff it differs byte-for-byte
 * from the canonical source. The canonical sources are static strings with no
 * interpolation exactly so this can be a plain string compare.
 */
export function isGrowthWorkflowSourceEdited(workflowId: string, storedSource: string): boolean {
  return storedSource !== getGrowthWorkflowSpec(workflowId).source;
}

/**
 * Creates any missing canonical Growth workflow definitions for this tenancy.
 * Existing definitions — edited or not — are left completely untouched.
 * Concurrent seeding is safe: the loser of the create race treats the winner's
 * definition as success (see isGrowthSeedRaceError).
 */
export async function ensureGrowthWorkflows(tenancy: Tenancy): Promise<Map<string, { created: boolean }>> {
  const results = new Map<string, { created: boolean }>();
  for (const [workflowId, spec] of GROWTH_WORKFLOW_DEFINITIONS) {
    const existing = await globalPrismaClient.workflowDefinition.findUnique({
      where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
      select: { workflowId: true },
    });
    if (existing != null) {
      results.set(workflowId, { created: false });
      continue;
    }
    try {
      await syncWorkflowSource(tenancy, { workflowId, source: spec.source, displayName: spec.displayName, mustBeNew: true });
      results.set(workflowId, { created: true });
    } catch (error) {
      if (isGrowthSeedRaceError(error) && await growthWorkflowExists(tenancy, workflowId)) {
        results.set(workflowId, { created: false });
        continue;
      }
      throw error;
    }
  }
  return results;
}

/**
 * Two seeders racing on the same missing definition can fail in two different ways, depending on
 * how far the winner got before the loser looked:
 *   - the winner's definition was already committed, so mustBeNew rejects with an already-exists 400;
 *   - the winner was still inside its own transaction, so both mint version 1 and the loser loses the
 *     WorkflowVersion unique constraint, which the workflow API reports as a 409.
 * Both mean "the definition we wanted now exists", so both are success for seeding — but the caller
 * only accepts them after re-reading the definition, so an unrelated conflict still propagates.
 */
export function isGrowthSeedRaceError(error: unknown): boolean {
  if (!StatusError.isStatusError(error)) return false;
  if (error.statusCode === 409) return true;
  return error.statusCode === 400 && error.message.includes("already exists");
}

async function growthWorkflowExists(tenancy: Tenancy, workflowId: string): Promise<boolean> {
  const definition = await globalPrismaClient.workflowDefinition.findUnique({
    where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
    select: { workflowId: true },
  });
  return definition != null;
}

export type GrowthWorkflowState = {
  workflowId: string,
  exists: boolean,
  edited: boolean,
  latestVersion: number | null,
};

/**
 * Per-canonical-workflow existence + drift, for the status wire and the
 * watchdog. "edited" compares the latest stored version's source against the
 * canonical const (see isGrowthWorkflowSourceEdited).
 */
export async function getGrowthWorkflowStates(tenancy: Tenancy): Promise<GrowthWorkflowState[]> {
  const states: GrowthWorkflowState[] = [];
  for (const workflowId of GROWTH_WORKFLOW_IDS) {
    const definition = await globalPrismaClient.workflowDefinition.findUnique({
      where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
      select: { latestVersion: true },
    });
    if (definition == null) {
      states.push({ workflowId, exists: false, edited: false, latestVersion: null });
      continue;
    }
    const latestVersion = await globalPrismaClient.workflowVersion.findUnique({
      where: { tenancyId_workflowId_version: { tenancyId: tenancy.id, workflowId, version: definition.latestVersion } },
      select: { source: true },
    }) ?? throwErr("WorkflowDefinition.latestVersion points at a missing version row — versions are only ever created together with the definition update, so this should be impossible.");
    states.push({
      workflowId,
      exists: true,
      edited: isGrowthWorkflowSourceEdited(workflowId, latestVersion.source),
      latestVersion: definition.latestVersion,
    });
  }
  return states;
}

/**
 * Explicitly resets one canonical Growth workflow back to its canonical
 * source (creating it if it was deleted). This is the ONLY path that
 * overwrites a customer-edited growth workflow, and it only runs on an
 * explicit admin request (the dashboard's "restore default" button).
 */
export async function restoreGrowthWorkflow(tenancy: Tenancy, workflowId: string): Promise<{ workflowId: string, version: number, created: boolean }> {
  if (!GROWTH_WORKFLOW_DEFINITIONS.has(workflowId)) {
    throw new StatusError(400, `"${workflowId}" is not a restorable Growth workflow (expected one of: ${GROWTH_WORKFLOW_IDS.join(", ")}).`);
  }
  const spec = getGrowthWorkflowSpec(workflowId);
  const existing = await globalPrismaClient.workflowDefinition.findUnique({
    where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
    select: { workflowId: true },
  });
  const result = await syncWorkflowSource(tenancy, {
    workflowId,
    source: spec.source,
    displayName: spec.displayName,
    mustBeNew: existing == null,
  });
  return { workflowId, version: result.version, created: result.created };
}
