import { issueCreatedWebhookEvent, issueIgnoredWebhookEvent, issueMergedWebhookEvent, issueRegressedWebhookEvent, issueResolvedWebhookEvent } from "@hexclave/shared/dist/interface/crud/issues";
import { projectPermissionCreatedWebhookEvent, projectPermissionDeletedWebhookEvent } from "@hexclave/shared/dist/interface/crud/project-permissions";
import { teamMembershipCreatedWebhookEvent, teamMembershipDeletedWebhookEvent } from "@hexclave/shared/dist/interface/crud/team-memberships";
import { teamPermissionCreatedWebhookEvent, teamPermissionDeletedWebhookEvent } from "@hexclave/shared/dist/interface/crud/team-permissions";
import { teamCreatedWebhookEvent, teamDeletedWebhookEvent, teamUpdatedWebhookEvent } from "@hexclave/shared/dist/interface/crud/teams";
import { userCreatedWebhookEvent, userDeletedWebhookEvent, userUpdatedWebhookEvent } from "@hexclave/shared/dist/interface/crud/users";
import { WebhookEvent } from "@hexclave/shared/dist/interface/webhooks";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, captureError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { Svix } from "svix";
import * as yup from "yup";
import { isPreviewModeEnabled } from "@/lib/preview-mode";
import type { Tenancy } from "@/lib/tenancies";

export function getSvixClient() {
  return new Svix(
    getEnvVariable("STACK_SVIX_API_KEY"),
    { serverUrl: getEnvVariable("STACK_SVIX_SERVER_URL", "") || undefined }
  );
}

/**
 * Whether a tenancy has the webhooks app installed and enabled.
 *
 * `sendWebhooks` deliberately does NOT check this — it only checks preview mode — and changing that would
 * alter the behavior of every existing event, so it belongs in its own change. Emit sites for high-frequency,
 * machine-triggered events (`issue.*`, which fire off a telemetry firehose rather than a human action) call
 * this first, so a project without the app installed does zero Svix work per ingest batch instead of one
 * `application.getOrCreate` round trip per event.
 */
export function isWebhooksAppEnabled(tenancy: Tenancy): boolean {
  return tenancy.config.apps.installed["webhooks"]?.enabled ?? false;
}

async function sendWebhooks(options: {
  type: string,
  projectId: string,
  data: any,
  /**
   * Svix's idempotency key. When set, Svix collapses repeated `message.create` calls carrying the same id
   * into a single delivery. Left undefined by every sender that predates issue events, so their on-the-wire
   * behavior is unchanged (the field is simply absent, exactly as before).
   */
  eventId?: string,
}) {
  if (isPreviewModeEnabled()) {
    return;
  }

  const svix = getSvixClient();

  try {
    await svix.application.getOrCreate({ uid: options.projectId, name: options.projectId });
  } catch (e: any) {
    if (e.message.includes("409")) {
      // This is a Svix bug; they are working on fixing it. We can ignore it for now (it means the app already exists).
      // TODO: remove this once it no longer appears on Sentry or during the E2E tests
      captureError("svix-409-hack", "Svix bug: 409 error when creating application. Remove this warning once Svix fixes this.");
    } else {
      throw e;
    }
  }
  await svix.message.create(options.projectId, {
    eventType: options.type,
    // Only spread the key when we have one: Svix treats an explicit `eventId: null` differently from an
    // absent field, and we do not want to change the payload existing subscribers receive.
    ...options.eventId === undefined ? {} : { eventId: options.eventId },
    payload: {
      type: options.type,
      data: options.data,
    },
  });
}

function createWebhookSender<T extends yup.Schema>(event: WebhookEvent<T>) {
  return async (options: { projectId: string, data: yup.InferType<typeof event.schema>, eventId?: string }) => {
    await Result.retry(async () => {
      try {
        return Result.ok(await sendWebhooks({
          type: event.type,
          projectId: options.projectId,
          data: options.data,
          eventId: options.eventId,
        }));
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "429") {
          // Rate limit. Let's retry later
          return Result.error(e);
        }
        throw new HexclaveAssertionError("Error sending Svix webhook!", { event: event.type, data: options.data, cause: e });
      }
    }, 5);
  };
}

export const sendUserCreatedWebhook = createWebhookSender(userCreatedWebhookEvent);
export const sendUserUpdatedWebhook = createWebhookSender(userUpdatedWebhookEvent);
export const sendUserDeletedWebhook = createWebhookSender(userDeletedWebhookEvent);
export const sendTeamCreatedWebhook = createWebhookSender(teamCreatedWebhookEvent);
export const sendTeamUpdatedWebhook = createWebhookSender(teamUpdatedWebhookEvent);
export const sendTeamDeletedWebhook = createWebhookSender(teamDeletedWebhookEvent);
export const sendTeamMembershipCreatedWebhook = createWebhookSender(teamMembershipCreatedWebhookEvent);
export const sendTeamMembershipDeletedWebhook = createWebhookSender(teamMembershipDeletedWebhookEvent);
export const sendTeamPermissionCreatedWebhook = createWebhookSender(teamPermissionCreatedWebhookEvent);
export const sendTeamPermissionDeletedWebhook = createWebhookSender(teamPermissionDeletedWebhookEvent);
export const sendProjectPermissionCreatedWebhook = createWebhookSender(projectPermissionCreatedWebhookEvent);
export const sendProjectPermissionDeletedWebhook = createWebhookSender(projectPermissionDeletedWebhookEvent);

/**
 * Like `createWebhookSender`, but `eventId` is required rather than optional.
 *
 * `createWebhookSender` retries up to 5 times on a 429, and a retry whose predecessor actually reached Svix
 * before failing would otherwise deliver the same event twice. That is tolerable for the human-triggered
 * events (a user is created once, by one request); it is not tolerable for events that fire off telemetry
 * ingest, where the retry path is exercised constantly and a duplicate looks to the subscriber like a second
 * real occurrence. Making the id required means an emit site cannot silently opt out of the guarantee.
 */
function createIdempotentWebhookSender<T extends yup.Schema>(event: WebhookEvent<T>) {
  const send = createWebhookSender(event);
  return async (options: { projectId: string, data: yup.InferType<typeof event.schema>, eventId: string }) => {
    await send(options);
  };
}

// Issue webhooks. The `eventId` convention, which the emit sites must follow:
//   - `issue.created`  → `${issueId}`, because an issue is created exactly once.
//   - state changes    → `${issueId}:${statusChangedAtMillis}`, so retrying one transition is idempotent
//                        while a genuine later transition of the same issue is a distinct event.
// The 5-minute emit throttle is NOT implemented here — it lives in the Postgres `UPDATE` that guards the
// write, so that the throttle and the concurrency control are the same thing. These senders stay unaware of
// it deliberately: a sender that also throttled would give two places the power to swallow an event.
export const sendIssueCreatedWebhook = createIdempotentWebhookSender(issueCreatedWebhookEvent);
export const sendIssueRegressedWebhook = createIdempotentWebhookSender(issueRegressedWebhookEvent);
export const sendIssueResolvedWebhook = createIdempotentWebhookSender(issueResolvedWebhookEvent);
export const sendIssueIgnoredWebhook = createIdempotentWebhookSender(issueIgnoredWebhookEvent);
export const sendIssueMergedWebhook = createIdempotentWebhookSender(issueMergedWebhookEvent);
