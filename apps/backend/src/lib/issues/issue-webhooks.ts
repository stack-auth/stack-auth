import { getPrismaClientForTenancy } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { isWebhooksAppEnabled, sendIssueCreatedWebhook, sendIssueIgnoredWebhook, sendIssueMergedWebhook, sendIssueRegressedWebhook, sendIssueResolvedWebhook } from "@/lib/webhooks";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import type { IssueStatus, IssueSubstatus } from "@hexclave/shared/dist/interface/admin-issues";
import type { IssueMaterializationOutcome } from "./issue-store";

/**
 * Emits `issue.*` webhooks for the issues a materialized batch touched.
 *
 * These events differ from every other webhook in this codebase in one way that
 * changes the design: they fire from a TELEMETRY FIREHOSE rather than from a
 * human action. `user.created` fires when a person signs up; `issue.regressed`
 * could fire once per ingest batch for a flapping issue. Three consequences:
 *
 *  1. Idempotency is mandatory. `sendWebhooks` is retried up to 5× on a Svix
 *     429, and Svix's own dedup is keyed on `eventId` — which the existing
 *     senders never set (visible as `"eventId": null` in every E2E snapshot).
 *     A retry that failed AFTER Svix accepted would double-deliver. The issue
 *     senders therefore require a deterministic `eventId` at the type level.
 *  2. A throttle is mandatory, and it lives in the Postgres write below rather
 *     than in the sender, so the throttle IS the concurrency control. Two
 *     concurrent batches cannot both pass it.
 *  3. The app gate is checked here rather than inside `sendWebhooks`: changing
 *     `sendWebhooks` would alter behaviour for every existing event, and a
 *     project that never installed webhooks should do zero Svix work per batch.
 */

/**
 * How long an issue must stay quiet before it may emit another state-change
 * webhook. Mirrors Sentry's per-rule "action interval", reduced to its essential
 * form.
 */
export const ISSUE_WEBHOOK_THROTTLE_MS = 5 * 60 * 1000;

/**
 * The Postgres enum, spelled as it comes back from `::text`. Kept as a literal
 * union rather than `string` so the mapping to the webhook's lowercase status
 * is exhaustive — a new `IssueStatus` value would fail to compile here instead
 * of silently shipping an unmapped string to customers' endpoints.
 */
type IssueStatusColumn = "UNRESOLVED" | "RESOLVED" | "IGNORED";

const WEBHOOK_STATUS_BY_COLUMN: Record<IssueStatusColumn, IssueStatus> = {
  UNRESOLVED: "unresolved",
  RESOLVED: "resolved",
  IGNORED: "ignored",
};

type IssueWebhookRow = {
  id: string,
  shortId: bigint,
  type: string,
  value: string,
  culprit: string,
  status: IssueStatusColumn,
  firstSeenAt: Date,
  lastSeenAt: Date,
  timesSeen: bigint,
  regressedAt: Date | null,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  lastSeenRelease: string | null,
};

function buildIssueWebhookData(tenancy: Tenancy, row: IssueWebhookRow, substatus: IssueSubstatus) {
  const dashboardUrl = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL", "");
  return {
    id: row.id,
    // Decimal strings, not numbers: these are Postgres BigInt, and the response
    // pipeline's `JSON.stringify` throws on a BigInt rather than coercing it.
    short_id: row.shortId.toString(),
    times_seen: row.timesSeen.toString(),
    type: row.type,
    value: row.value,
    culprit: row.culprit,
    level: "error",
    status: WEBHOOK_STATUS_BY_COLUMN[row.status],
    substatus,
    first_seen_at_millis: row.firstSeenAt.getTime(),
    last_seen_at_millis: row.lastSeenAt.getTime(),
    service_name: row.serviceName,
    environment: row.deploymentEnvironmentName,
    release: row.lastSeenRelease,
    // The first thing anyone does with an issue webhook is click through, so
    // the deep link ships in the payload rather than making every consumer
    // reconstruct it.
    url: dashboardUrl === ""
      ? ""
      : urlString`${dashboardUrl}/projects/${tenancy.project.id}/observability/issues/${row.id}`,
  };
}

/**
 * Claims the right to emit, for the issues that are outside their throttle
 * window.
 *
 * `UPDATE … WHERE lastWebhookAt < now - interval` and then acting only on the
 * RETURNED rows means the database decides who emits. A read-then-decide-then-
 * write would let two concurrent batches both observe a stale `lastWebhookAt`
 * and both fire.
 *
 * `issue.created` deliberately bypasses the throttle: an issue is created once,
 * so there is nothing to throttle, and suppressing it would mean a brand-new
 * issue that happened to arrive alongside a regression went unannounced.
 */
async function claimWebhookSlots(
  tenancy: Tenancy,
  issueIds: readonly string[],
  now: Date,
): Promise<Map<string, IssueWebhookRow>> {
  if (issueIds.length === 0) return new Map();
  const prisma = await getPrismaClientForTenancy(tenancy);

  const rows = await prisma.$queryRaw<IssueWebhookRow[]>`
    UPDATE "Issue"
    SET "lastWebhookAt" = ${now}::timestamptz
    WHERE "tenancyId" = ${tenancy.id}::uuid
      AND "id" = ANY(${issueIds}::uuid[])
      AND ("lastWebhookAt" IS NULL OR "lastWebhookAt" < ${new Date(now.getTime() - ISSUE_WEBHOOK_THROTTLE_MS)}::timestamptz)
    RETURNING "id", "shortId", "type", "value", "culprit", "status"::text AS "status",
              "firstSeenAt", "lastSeenAt", "timesSeen", "regressedAt",
              "serviceName", "deploymentEnvironmentName", "lastSeenRelease"
  `;
  return new Map(rows.map((row) => [row.id, row]));
}

export async function emitIssueWebhooks(options: {
  tenancy: Tenancy,
  outcomes: readonly IssueMaterializationOutcome[],
  now: Date,
}): Promise<void> {
  const { tenancy, outcomes, now } = options;
  if (outcomes.length === 0) return;
  if (!isWebhooksAppEnabled(tenancy)) return;

  const notable = outcomes.filter((outcome) => outcome.isNew || outcome.isRegression);
  if (notable.length === 0) return;

  const claimed = await claimWebhookSlots(tenancy, notable.map((outcome) => outcome.issueId), now);
  if (claimed.size === 0) return;

  await Promise.all(notable.flatMap((outcome) => {
    const row = claimed.get(outcome.issueId);
    if (row === undefined) return [];

    if (outcome.isNew) {
      return [sendIssueCreatedWebhook({
        projectId: tenancy.project.id,
        data: buildIssueWebhookData(tenancy, row, "new"),
        // An issue is created exactly once, so its own id is a naturally stable
        // idempotency key.
        eventId: row.id,
      })];
    }

    return [sendIssueRegressedWebhook({
      projectId: tenancy.project.id,
      data: buildIssueWebhookData(tenancy, row, "regressed"),
      // Keyed on the regression INSTANT, so a re-delivery of the same
      // regression dedupes while a genuine second regression later does not.
      eventId: `${row.id}:${(row.regressedAt ?? now).getTime()}`,
    })];
  }));
}

/**
 * Emits the lifecycle events that come from a HUMAN action rather than from
 * ingest: `issue.resolved`, `issue.ignored`, and `issue.merged`.
 *
 * These deliberately bypass the `lastWebhookAt` throttle that `emitIssueWebhooks`
 * applies. That throttle exists because ingest-driven events fire from a
 * firehose; a person clicking Resolve is not a firehose, and swallowing their
 * action because an unrelated regression fired four minutes ago would make the
 * webhook stream lie about the issue's state.
 *
 * The `eventId` is keyed on the transition INSTANT, so a redelivery of the same
 * click dedupes while a genuine resolve → reopen → resolve later does not.
 */
export async function emitIssueLifecycleWebhook(options: {
  tenancy: Tenancy,
  issueId: string,
  event: "resolved" | "ignored" | "merged",
  now: Date,
}): Promise<void> {
  const { tenancy, issueId, event, now } = options;
  if (!isWebhooksAppEnabled(tenancy)) return;

  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$queryRaw<IssueWebhookRow[]>`
    SELECT "id", "shortId", "type", "value", "culprit", "status"::text AS "status",
           "firstSeenAt", "lastSeenAt", "timesSeen", "regressedAt",
           "serviceName", "deploymentEnvironmentName", "lastSeenRelease"
    FROM "Issue"
    WHERE "tenancyId" = ${tenancy.id}::uuid AND "id" = ${issueId}::uuid
    LIMIT 1
  `;
  if (rows.length === 0) return;
  const row = rows[0];

  // An issue that was just resolved or merged away is no longer "new" or
  // "regressed" from a consumer's point of view.
  const data = buildIssueWebhookData(tenancy, row, "ongoing");
  const eventId = `${row.id}:${event}:${now.getTime()}`;

  switch (event) {
    case "resolved": {
      await sendIssueResolvedWebhook({ projectId: tenancy.project.id, data, eventId });
      return;
    }
    case "ignored": {
      await sendIssueIgnoredWebhook({ projectId: tenancy.project.id, data, eventId });
      return;
    }
    case "merged": {
      await sendIssueMergedWebhook({ projectId: tenancy.project.id, data, eventId });
      return;
    }
  }
}
