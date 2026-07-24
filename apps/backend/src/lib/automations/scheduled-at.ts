import { StatusError } from "@hexclave/shared/dist/utils/errors";

export function parseAutomationScheduledAtMillis(value: number | undefined, label: "scheduled_at_millis" | "scheduledAtMillis") {
  if (value === undefined) {
    return new Date();
  }

  const scheduledAt = new Date(value);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new StatusError(StatusError.BadRequest, `${label} must be a valid JavaScript timestamp in milliseconds.`);
  }
  return scheduledAt;
}
