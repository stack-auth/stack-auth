import { StatusError } from "@hexclave/shared/dist/utils/errors";

// The ONE rollout gate for workflows (Workflows v1 spec, section 11).
// Workflows launch enabled ONLY for the internal project; everything else is
// built multi-tenant so opening the feature up later changes ONLY this file
// (e.g. by turning it into a per-project entitlement lookup).
//
// The gate is enforced at every layer that does work, not just UI: all
// workflows API routes call it first, event enqueueing checks it before
// inserting outbox rows, and the engine tick only ever sees rows that passed
// it at enqueue time.

const WORKFLOWS_ENABLED_PROJECT_ID = "internal";

export function areWorkflowsEnabled(projectId: string): boolean {
  return projectId === WORKFLOWS_ENABLED_PROJECT_ID;
}

export function ensureWorkflowsEnabled(projectId: string): void {
  if (!areWorkflowsEnabled(projectId)) {
    // 404-shaped on purpose: for projects where the gate is closed, the
    // feature does not exist (this is not a 403 "you lack permission" — there
    // is nothing to have permission to).
    throw new StatusError(StatusError.NotFound, "Workflows are not available for this project.");
  }
}
