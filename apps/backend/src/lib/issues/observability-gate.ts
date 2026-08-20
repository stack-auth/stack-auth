import type { Tenancy } from "@/lib/tenancies";
import { KnownErrors } from "@hexclave/shared";

export function assertObservabilityEnabled(tenancy: Tenancy): void {
  if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
    throw new KnownErrors.ObservabilityNotEnabled();
  }
}
