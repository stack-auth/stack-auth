import type { SmartRequest } from "@/route-handlers/smart-request";
import {
  adaptSchema,
  clientOrHigherAuthTypeSchema,
  serverOrHigherAuthTypeSchema,
  yupObject,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  createSavedIssueSearchViewMutationAuthorization,
  type SavedIssueSearchViewMutationAuthorization,
} from "@/lib/issues/saved-search-views/persistence";

export const SavedIssueSearchViewAuthSchema = yupObject({
  type: serverOrHigherAuthTypeSchema.defined(),
  tenancy: adaptSchema.defined(),
}).defined();

export const SavedIssueSearchViewMutationAuthSchema = yupObject({
  type: clientOrHigherAuthTypeSchema.defined(),
  tenancy: adaptSchema.defined(),
}).defined();

export function savedIssueSearchViewActorUserId(fullReq: SmartRequest): string | null {
  return fullReq.auth?.user?.id ?? null;
}

export function savedIssueSearchViewMutationAuthorization(fullReq: SmartRequest): SavedIssueSearchViewMutationAuthorization {
  if (fullReq.auth === null) {
    throw new StatusError(StatusError.Forbidden, "saved issue search view mutation requires authenticated access");
  }
  return createSavedIssueSearchViewMutationAuthorization({
    authType: fullReq.auth.type,
    actorUserId: savedIssueSearchViewActorUserId(fullReq),
  });
}
