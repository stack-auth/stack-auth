import type { Tenancy } from "@/lib/tenancies";
import { KnownErrors } from "@hexclave/shared";

/**
 * The observability app owns every issues surface (lists, detail, occurrences,
 * actions, attachments, search, alerts, saved views). Gating at the top of each
 * route — rather than only in the dashboard — keeps a project that never
 * enabled the app from paying for any Postgres or ClickHouse round trip, and a
 * single shared assertion keeps all of those surfaces agreeing on what
 * "enabled" means.
 */
export function assertObservabilityEnabled(tenancy: Tenancy): void {
  if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
    throw new KnownErrors.ObservabilityNotEnabled();
  }
}
