import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GROWTH_ADMIN_ACTION_STATUSES = ["proposed", "active", "completed", "dismissed"] as const;
export type GrowthAdminActionStatus = typeof GROWTH_ADMIN_ACTION_STATUSES[number];

export function assertGrowthAdminActionStatus(value: string): GrowthAdminActionStatus {
  const status = GROWTH_ADMIN_ACTION_STATUSES.find((candidate) => candidate === value);
  if (status == null) throw new StatusError(400, "Invalid Growth action status.");
  return status;
}

/** Validates the admin's requested transition before any editable copy is persisted. */
export function assertGrowthAdminActionTransition(currentValue: string, requestedValue: string): GrowthAdminActionStatus {
  const current = assertGrowthAdminActionStatus(currentValue);
  const requested = assertGrowthAdminActionStatus(requestedValue);
  if (requested === "completed" && current !== "completed") throw new StatusError(400, "Completed is derived from the Growth state machine and cannot be set manually.");
  if (requested === "proposed" && current !== "proposed") throw new StatusError(400, "An action cannot transition back to proposed.");
  if ((current === "completed" || current === "dismissed") && requested !== current) {
    throw new StatusError(400, `A ${current} action has no transition to ${requested}.`);
  }
  return requested;
}
