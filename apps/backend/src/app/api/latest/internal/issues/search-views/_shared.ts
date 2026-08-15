import type { SmartRequest } from "@/route-handlers/smart-request";
import { adaptSchema, adminAuthTypeSchema, yupObject } from "@hexclave/shared/dist/schema-fields";

export const InternalSavedIssueSearchViewAuthSchema = yupObject({
  type: adminAuthTypeSchema.defined(),
  tenancy: adaptSchema.defined(),
}).defined();

/**
 * Admin-key requests normally have no end-user identity. Returning null here
 * is deliberate: the persistence layer then exposes and creates only
 * project-visible views. We must not turn the dashboard's admin key into a
 * fake private-view owner, because that would make every dashboard operator
 * share one indistinguishable private namespace.
 */
export function internalSavedIssueSearchViewActorUserId(fullReq: SmartRequest): string | null {
  return fullReq.auth?.user?.id ?? null;
}
