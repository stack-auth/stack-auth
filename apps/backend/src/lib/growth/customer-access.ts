import type { Tenancy } from "@/lib/tenancies";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const GROWTH_INTERNAL_RESOURCE_UNAVAILABLE = "This Growth resource is not available.";

/**
 * The customer Growth routes and the staff admin routes intentionally share the same project
 * tenancy machinery. Customer sessions resolve to their onboarded project; staff sessions resolve
 * to the internal project and reach customer data through the admin routes. Keep this check at the
 * route boundary so internal findings, notes, and action details cannot leak through a customer
 * session even if a page forgets to hide a link.
 */
export function requireGrowthInternalResourceAccess(tenancy: Tenancy): void {
  if (tenancy.project.id !== "internal") {
    throw new StatusError(403, GROWTH_INTERNAL_RESOURCE_UNAVAILABLE);
  }
}

export function isGrowthCustomerTenancy(tenancy: Tenancy): boolean {
  return tenancy.project.id !== "internal";
}
