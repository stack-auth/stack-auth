import type { CompleteConfig } from "../config/schema";

export type SupportSlaConfig = {
  enabled: boolean,
  firstResponseMinutes: number | null,
  nextResponseMinutes: number | null,
};

export const DEFAULT_SUPPORT_SLA: SupportSlaConfig = {
  enabled: false,
  firstResponseMinutes: null,
  nextResponseMinutes: null,
};

/**
 * Resolves the SLA config from a rendered project config, filling in safe
 * defaults for any missing fields. Always returns a fully-populated object.
 */
export function resolveSupportSla(supportConfig: CompleteConfig["support"] | undefined | null): SupportSlaConfig {
  const sla = supportConfig?.sla;
  if (sla == null) return DEFAULT_SUPPORT_SLA;
  return {
    enabled: sla.enabled ?? DEFAULT_SUPPORT_SLA.enabled,
    firstResponseMinutes: sla.firstResponseMinutes ?? null,
    nextResponseMinutes: sla.nextResponseMinutes ?? null,
  };
}

function addMinutesOrNull(now: Date, minutes: number | null): Date | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Returns the target first-response due timestamp for a new conversation,
 * or `null` if SLA tracking is off or no target is set.
 */
export function computeFirstResponseDueAt(
  now: Date,
  sla: SupportSlaConfig,
): Date | null {
  if (!sla.enabled) return null;
  return addMinutesOrNull(now, sla.firstResponseMinutes);
}

/**
 * Returns the target next-response due timestamp when a conversation has been
 * re-opened by a user reply, or `null` if SLA tracking is off or no target
 * is set.
 */
export function computeNextResponseDueAt(
  now: Date,
  sla: SupportSlaConfig,
): Date | null {
  if (!sla.enabled) return null;
  return addMinutesOrNull(now, sla.nextResponseMinutes);
}

export type SlaUrgency = "ok" | "warning" | "urgent" | "overdue";

/**
 * How soon (in milliseconds) before a due timestamp we switch into the
 * "urgent" state. Within this window the due timestamp should be rendered
 * with a strong alert treatment.
 */
export const SLA_URGENT_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * How soon (in milliseconds) before a due timestamp we switch into the
 * "warning" state. Within this window the due timestamp should be rendered
 * with a subtle alert treatment so agents can notice it without being
 * distracted.
 */
export const SLA_WARNING_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Classifies how close a due timestamp is to `now` so we can subtly alert
 * agents as it approaches (and after it passes).
 *
 * If `windowStartedAt` is provided, thresholds scale with the total SLA
 * window length - so a 5-minute SLA doesn't read as "urgent" from t=0 - and
 * are capped by the fixed wall-clock thresholds so a 24-hour SLA doesn't
 * sit in "warning" for 12 hours. If `windowStartedAt` isn't known, we fall
 * back to the fixed wall-clock thresholds.
 */
export function computeSlaUrgency(
  dueAt: Date,
  now: Date,
  options?: { windowStartedAt?: Date | null },
): SlaUrgency {
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs <= 0) return "overdue";

  const windowStartedAt = options?.windowStartedAt ?? null;
  const totalWindowMs = windowStartedAt != null
    ? Math.max(1, dueAt.getTime() - windowStartedAt.getTime())
    : null;

  const urgentThresholdMs = totalWindowMs != null
    ? Math.min(totalWindowMs * 0.25, SLA_URGENT_THRESHOLD_MS)
    : SLA_URGENT_THRESHOLD_MS;
  const warningThresholdMs = totalWindowMs != null
    ? Math.min(totalWindowMs * 0.5, SLA_WARNING_THRESHOLD_MS)
    : SLA_WARNING_THRESHOLD_MS;

  if (remainingMs <= urgentThresholdMs) return "urgent";
  if (remainingMs <= warningThresholdMs) return "warning";
  return "ok";
}
