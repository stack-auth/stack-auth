import * as yup from "yup";
import { issueCreatedWebhookEvent, issueIgnoredWebhookEvent, issueMergedWebhookEvent, issueRegressedWebhookEvent, issueResolvedWebhookEvent } from "./crud/issues";
import { teamMembershipCreatedWebhookEvent, teamMembershipDeletedWebhookEvent } from "./crud/team-memberships";
import { teamPermissionCreatedWebhookEvent, teamPermissionDeletedWebhookEvent } from "./crud/team-permissions";
import { teamCreatedWebhookEvent, teamDeletedWebhookEvent, teamUpdatedWebhookEvent } from "./crud/teams";
import { userCreatedWebhookEvent, userDeletedWebhookEvent, userUpdatedWebhookEvent } from "./crud/users";

export type WebhookEvent<S extends yup.Schema> = {
  type: string,
  schema: S,
  metadata: {
    summary: string,
    description: string,
    tags?: string[],
  },
};

// Every event that customers can subscribe to MUST be listed here: this array is the sole input to
// `parseWebhookOpenAPI`, which generates `docs-mintlify/openapi/webhooks.json`. An event that is emitted but
// missing from this list is undocumented and effectively invisible (see `project_permission.created` /
// `project_permission.deleted`, which are emitted today and are not listed).
export const webhookEvents = [
  userCreatedWebhookEvent,
  userUpdatedWebhookEvent,
  userDeletedWebhookEvent,
  teamCreatedWebhookEvent,
  teamUpdatedWebhookEvent,
  teamDeletedWebhookEvent,
  teamMembershipCreatedWebhookEvent,
  teamMembershipDeletedWebhookEvent,
  teamPermissionCreatedWebhookEvent,
  teamPermissionDeletedWebhookEvent,
  issueCreatedWebhookEvent,
  issueRegressedWebhookEvent,
  issueResolvedWebhookEvent,
  issueIgnoredWebhookEvent,
  issueMergedWebhookEvent,
] as const;
