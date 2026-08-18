import { WORKFLOW_CUSTOM_EVENT_PREFIX, type WorkflowTriggerJson } from "@hexclave/shared/dist/interface/workflows";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_METRIC_IDS, GrowthMetricId, GrowthWatchedMetric } from "./action-item-types";
import { GROWTH_ACTION_EVENT_NAME_PREFIX, getGrowthActionEventSlug } from "./workflow-authoring";

/**
 * Pure GrowthActionItem wire/column parsing, split out of actions.ts specifically so
 * `action-workflow-sync.ts` (imported by watchdog.ts, imported by dashboard.ts, imported by the
 * growth-server cron/webhook routes) can depend on JUST these functions without dragging in the rest
 * of actions.ts.
 *
 * That split is load-bearing, not cosmetic, and it is worth keeping even though actions.ts is
 * currently ads-free. The ad platform integration puts a spend-capable write seam behind the run_ads
 * activation/dismissal flows in actions.ts, and that seam must be unreachable from
 * `app/api/latest/internal/growth-server/**` — that surface is machine-secret-authenticated the same
 * way growth-agent is, and must have no path to creating or activating real ad spend. Without this
 * split, `action-workflow-sync.ts -> ./actions -> <write seam>` is exactly such a path, even though
 * action-workflow-sync.ts never touches ads at all — it just happens to want three unrelated pure
 * functions that used to live in the same file. Nothing in THIS file may import a write seam,
 * directly or transitively; if a future change needs to, it belongs in actions.ts, not here.
 */

function assertGrowthMetricId(value: string): GrowthMetricId {
  return GROWTH_METRIC_IDS.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`Unknown growth metric id "${value}" — watched metrics are validated at write time against the registry, so this should be impossible.`, { value }));
}

/**
 * Parses GrowthActionItem.watchedMetrics back into typed form. The column is always written from
 * resolveGrowthWatchedMetrics, so anything else means the row was corrupted. Exported for the
 * watchdog's action-workflow sweep (action-workflow-sync.ts), which needs the watch windows to
 * decide when a recurring automation's observation period has elapsed.
 */
export function parseWatchedMetrics(json: unknown): GrowthWatchedMetric[] {
  if (!Array.isArray(json)) {
    throw new HexclaveAssertionError("GrowthActionItem.watchedMetrics is not an array", { json });
  }
  return json.map((entry) => {
    if (typeof entry !== "object" || entry == null || !("metricId" in entry) || !("windowDays" in entry) || typeof entry.metricId !== "string" || typeof entry.windowDays !== "number") {
      throw new HexclaveAssertionError("GrowthActionItem.watchedMetrics entry has an unexpected shape", { entry });
    }
    return { metricId: assertGrowthMetricId(entry.metricId), windowDays: entry.windowDays };
  });
}

/**
 * Parses the stored GrowthActionItem.workflowManifest triggers back into the manifest trigger JSON
 * shape. The column is only ever written from a dry-compile's WorkflowManifestJson (agent-writes),
 * so any other shape means the row was corrupted. Exported for the watchdog's action-workflow
 * sweep, which classifies workflows from the same stored manifest.
 */
export function parseStoredGrowthWorkflowManifestTriggers(json: unknown): WorkflowTriggerJson[] {
  if (typeof json !== "object" || json == null || Array.isArray(json) || !("triggers" in json) || !Array.isArray(json.triggers)) {
    throw new HexclaveAssertionError("GrowthActionItem.workflowManifest is not a manifest object with a triggers array", { json });
  }
  return json.triggers.map((trigger: unknown): WorkflowTriggerJson => {
    if (typeof trigger !== "object" || trigger == null || Array.isArray(trigger) || !("type" in trigger)) {
      throw new HexclaveAssertionError("GrowthActionItem.workflowManifest trigger has an unexpected shape", { trigger });
    }
    if (trigger.type === "event" && "event_type" in trigger && typeof trigger.event_type === "string") {
      return { type: "event", event_type: trigger.event_type };
    }
    if (trigger.type === "schedule" && "cron" in trigger && "timezone" in trigger && typeof trigger.cron === "string" && typeof trigger.timezone === "string") {
      return { type: "schedule", cron: trigger.cron, timezone: trigger.timezone };
    }
    throw new HexclaveAssertionError("GrowthActionItem.workflowManifest trigger has an unknown type or missing fields", { trigger });
  });
}

/** The wire type of the one-shot activation event for a workflow-bearing action item. */
export function getGrowthActionActivationEventType(workflowId: string): string {
  return `${WORKFLOW_CUSTOM_EVENT_PREFIX}${GROWTH_ACTION_EVENT_NAME_PREFIX}${getGrowthActionEventSlug(workflowId)}`;
}

/** Whether the manifest triggers include the item's OWN one-shot activation event. */
export function growthManifestTriggersIncludeActivationEvent(triggers: WorkflowTriggerJson[], workflowId: string): boolean {
  const expected = getGrowthActionActivationEventType(workflowId);
  return triggers.some((trigger) => trigger.type === "event" && trigger.event_type === expected);
}

/** Order-insensitive trigger set comparison (see the drift assertion in actions.ts's deployGrowthActionWorkflow). */
export function growthWorkflowTriggerSetsEqual(a: WorkflowTriggerJson[], b: WorkflowTriggerJson[]): boolean {
  const key = (trigger: WorkflowTriggerJson) => trigger.type === "event" ? `event:${trigger.event_type}` : `schedule:${trigger.cron}|${trigger.timezone}`;
  const keysA = a.map(key).sort();
  const keysB = b.map(key).sort();
  return keysA.length === keysB.length && keysA.every((value, index) => value === keysB[index]);
}
