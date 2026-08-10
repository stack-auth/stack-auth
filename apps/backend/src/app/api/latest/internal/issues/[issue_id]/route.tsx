import { Prisma } from "@/generated/prisma/client";
import { createProductionErrorAttachmentService } from "@/lib/attachments";
import { getErrorAttachmentEventId } from "@/lib/attachments/attachment-event-id";
import { validateErrorAttachmentScope } from "@/lib/attachments/attachment-contract";
import { decodeOccurrenceCursor, deriveSubstatus, issueRangeStart, loadIssueWindowStats, loadOccurrence } from "@/lib/issues/issue-queries";
import { emitIssueLifecycleWebhook } from "@/lib/issues/issue-webhooks";
import { loadIssueProductSnapshot } from "@/lib/issues/issue-product";
import { serializeIssueProductSnapshot } from "@/lib/issues/issue-product-projection";
import { projectPublicIssueOccurrence } from "@/lib/issues/public-issue-api";
import { loadIssueReleaseContext } from "@/lib/releases/issue-release-context";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { scrubErrorIngestPayload } from "@/lib/error-ingest";
import {
  IssueDetailResponseSchema,
  IssueUpdateRequestSchema,
  type IssueAttachment,
  type IssueListItem,
} from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import type { Tenancy } from "@/lib/tenancies";

type ResolvedIssue = {
  item: IssueListItem,
  hashes: string[],
  firstSeenRelease: string | null,
  lastSeenRelease: string | null,
  ignoredUntil: Date | null,
  /** Non-null when the requested id was a merged-away issue. */
  redirectedFromIssueId: string | null,
};

/**
 * Resolves the `[issue_id]` segment, which accepts three forms:
 *   - a uuid (the primary key)
 *   - an all-digits short id (what the UI shows and what people paste in chat)
 *   - a uuid that has since been merged away, via `IssueRedirect`
 *
 * The short-id form is why this is a lookup rather than a `findUnique`: short
 * ids are per-tenancy `BigInt`s, so `42` is only meaningful together with the
 * authenticated tenancy.
 *
 * Redirects are followed exactly ONE hop by design — merge rewrites inbound
 * redirects rather than chaining them, so a chain would indicate a bug rather
 * than a state to traverse. Looping here would hide that.
 */
async function resolveIssue(
  tenancy: Tenancy,
  rawId: string,
  rangeStart: Date,
  hopsRemaining: number = 1,
): Promise<ResolvedIssue | null> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const isShortId = /^\d+$/.test(rawId);
  if (!isShortId && !isUuid(rawId)) {
    throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
  }

  // Two distinct predicates rather than one clause with a runtime branch: the
  // columns have different types (`bigint` vs `uuid`), so a single query would
  // have to cast one of them per row and lose its index.
  const identityPredicate = isShortId
    ? Prisma.sql`i."shortId" = ${rawId}::bigint`
    : Prisma.sql`i."id" = ${rawId}::uuid`;

  const rows = await prisma.$queryRaw<{
    id: string, shortId: bigint, type: string, value: string, culprit: string,
    status: string, firstSeenAt: Date, lastSeenAt: Date, regressedAt: Date | null,
    timesSeen: bigint, countersTruncatedAt: Date | null, ignoredUntil: Date | null,
    serviceName: string | null, deploymentEnvironmentName: string | null,
    firstSeenRelease: string | null, lastSeenRelease: string | null, updatedAt: Date,
    handled: boolean, synthetic: boolean, hashes: string[],
  }[]>(Prisma.sql`
    SELECT i."id", i."shortId", i."type", i."value", i."culprit", i."status"::text AS "status",
           i."firstSeenAt", i."lastSeenAt", i."regressedAt", i."timesSeen",
           i."countersTruncatedAt", i."ignoredUntil", i."serviceName",
           i."deploymentEnvironmentName", i."firstSeenRelease", i."lastSeenRelease", i."updatedAt",
           i."handled", i."synthetic",
           COALESCE(
             (SELECT array_agg(h."hash") FROM "IssueHash" h
              WHERE h."tenancyId" = i."tenancyId" AND h."issueId" = i."id"),
             ARRAY[]::text[]
           ) AS "hashes"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid AND ${identityPredicate}
    LIMIT 1
  `);

  let redirectedFromIssueId: string | null = null;

  if (rows.length === 0) {
    // Short ids resolve through redirects too. They are the ids users actually
    // type and paste into chat, so a merged-away short id 404ing would break
    // exactly the links people share — which is why `IssueRedirect` carries
    // `fromShortId` with its own unique constraint.
    const redirectPredicate = isShortId
      ? Prisma.sql`"fromShortId" = ${rawId}::bigint`
      : Prisma.sql`"fromIssueId" = ${rawId}::uuid`;
    const redirected = await prisma.$queryRaw<{ fromIssueId: string, toIssueId: string }[]>(Prisma.sql`
      SELECT "fromIssueId", "toIssueId" FROM "IssueRedirect"
      WHERE "tenancyId" = ${tenancy.id}::uuid AND ${redirectPredicate}
      LIMIT 1
    `);
    if (redirected.length === 0) return null;
    // Merge REWRITES inbound redirects instead of chaining them, so a second
    // hop would mean the redirect table is corrupt. Refuse to walk it rather
    // than recursing without a bound — an accidental cycle would otherwise hang
    // the request until the connection times out.
    if (hopsRemaining <= 0) return null;
    // The merged-away ISSUE's id, not the raw path segment — the segment may
    // have been a short id, and the field's whole purpose is letting the
    // dashboard rewrite the URL to the surviving issue.
    redirectedFromIssueId = redirected[0].fromIssueId;
    const followed = await resolveIssue(tenancy, redirected[0].toIssueId, rangeStart, hopsRemaining - 1);
    if (followed === null) return null;
    return { ...followed, redirectedFromIssueId };
  }

  if (rows.length === 0) return null;
  const resolvedRow = rows[0];

  const now = new Date();
  // Shared with the list so a detail page can never disagree with the row that
  // linked to it.
  const substatus = deriveSubstatus(resolvedRow, rangeStart);
  const status = resolvedRow.status === "IGNORED" && resolvedRow.ignoredUntil !== null && resolvedRow.ignoredUntil < now
    ? "unresolved"
    : resolvedRow.status.toLowerCase() as IssueListItem["status"];

  return {
    hashes: resolvedRow.hashes,
    firstSeenRelease: resolvedRow.firstSeenRelease,
    lastSeenRelease: resolvedRow.lastSeenRelease,
    ignoredUntil: resolvedRow.ignoredUntil,
    redirectedFromIssueId,
    item: {
      id: resolvedRow.id,
      short_id: resolvedRow.shortId.toString(),
      type: resolvedRow.type,
      value: resolvedRow.value,
      culprit: resolvedRow.culprit,
      level: "error",
      status,
      substatus,
      first_seen_at_millis: resolvedRow.firstSeenAt.getTime(),
      last_seen_at_millis: resolvedRow.lastSeenAt.getTime(),
      times_seen: resolvedRow.timesSeen.toString(),
      counters_truncated_at_millis: resolvedRow.countersTruncatedAt?.getTime() ?? null,
      // Filled in by the caller from the rollup; the resolver itself only
      // touches Postgres.
      window_occurrences: 0,
      window_users: 0,
      service_name: resolvedRow.serviceName,
      environment: resolvedRow.deploymentEnvironmentName,
      release: resolvedRow.lastSeenRelease,
      handled: resolvedRow.handled,
      synthetic: resolvedRow.synthetic,
      updated_at_millis: resolvedRow.updatedAt.getTime(),
      issue_hashes: resolvedRow.hashes,
    },
  };
}

function parseErrorEnvelope(raw: string): Record<string, unknown> | null {
  if (raw === "" || raw === "{}") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const scrubbed = scrubErrorIngestPayload(parsed).value;
  if (scrubbed === undefined || typeof scrubbed !== "object" || scrubbed === null || Array.isArray(scrubbed)) return null;
  return scrubbed;
}

function serializeIssueAttachment(attachment: {
  id: string,
  eventId: string,
  occurrenceId: string | null,
  filename: string,
  contentType: string,
  attachmentType: string,
  byteLength: number,
  sha256: string,
  createdAt: Date,
}): IssueAttachment {
  return {
    id: attachment.id,
    event_id: attachment.eventId,
    occurrence_id: attachment.occurrenceId,
    filename: attachment.filename,
    content_type: attachment.contentType,
    attachment_type: attachment.attachmentType,
    byte_length: attachment.byteLength,
    sha256: attachment.sha256,
    download_path: `/api/latest/analytics/attachments/${encodeURIComponent(attachment.id)}`,
    created_at: attachment.createdAt.toISOString(),
  };
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({ issue_id: yupString().defined() }).defined(),
    query: yupObject({
      occurrence: yupString().optional(),
      direction: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueDetailResponseSchema,
  }),
  async handler({ auth, params, query }) {
    const tenancy = auth.tenancy;
    if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    const rangeStart = issueRangeStart(24, new Date());
    const resolved = await resolveIssue(tenancy, params.issue_id, rangeStart);
    if (resolved === null) throw new StatusError(StatusError.NotFound, "Issue not found");

    const cursor = query.occurrence === undefined ? null : decodeOccurrenceCursor(query.occurrence);
    const { occurrence, newerCursor, olderCursor } = await loadOccurrence({
      tenancy,
      hashes: resolved.hashes,
      cursor,
      direction: query.direction === "newer" ? "newer" : "older",
    });

    // The detail header shows the same window-scoped counts as the list column,
    // so they come from the same rollup rather than being recomputed (or, as
    // they briefly were, left at zero).
    const windowStats = await loadIssueWindowStats({ tenancy, hashes: resolved.hashes, rangeStart });
    const product = await loadIssueProductSnapshot({ tenancy, issueId: resolved.item.id });
    const releaseContext = await loadIssueReleaseContext({
      tenancy,
      issueId: resolved.item.id,
      firstSeenRelease: resolved.firstSeenRelease,
      lastSeenRelease: resolved.lastSeenRelease,
    });
    const errorEnvelope = occurrence === null ? null : parseErrorEnvelope(occurrence.error_envelope);
    const attachmentEventId = occurrence === null ? null : getErrorAttachmentEventId({
      occurrenceId: occurrence.occurrence_id,
      data: occurrence.data,
      errorEnvelope,
    });
    const attachments = attachmentEventId === null
      ? []
      : await (await createProductionErrorAttachmentService(tenancy)).list(
        validateErrorAttachmentScope({
          tenantId: tenancy.id,
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
        }),
        attachmentEventId,
      );
    const projectedOccurrence = occurrence === null ? null : await projectPublicIssueOccurrence(
      occurrence,
      resolved.item.release,
      {
        scope: {
          tenantId: tenancy.id,
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
        },
        attachments: attachments.map(serializeIssueAttachment),
      },
    );

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        issue: {
          ...resolved.item,
          window_occurrences: windowStats.occurrences,
          window_users: windowStats.users,
        },
        occurrence: projectedOccurrence === null ? null : {
          ...projectedOccurrence,
          error_envelope: errorEnvelope,
        },
        newer_cursor: newerCursor,
        older_cursor: olderCursor,
        product: serializeIssueProductSnapshot(product),
        release_context: releaseContext,
        redirected_from_issue_id: resolved.redirectedFromIssueId,
      },
    } as const;
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({ issue_id: yupString().defined() }).defined(),
    body: IssueUpdateRequestSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ id: yupString().defined(), status: yupString().defined() }).defined(),
  }),
  async handler({ auth, params, body }) {
    const tenancy = auth.tenancy;
    if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    const resolved = await resolveIssue(tenancy, params.issue_id, issueRangeStart(24, new Date()));
    if (resolved === null) throw new StatusError(StatusError.NotFound, "Issue not found");

    const prisma = await getPrismaClientForTenancy(tenancy);
    const now = new Date();
    const nextStatus = body.status.toUpperCase();

    // `resolvedAt` is set on every transition INTO resolved, because it is what
    // the ingest path compares a later occurrence against to decide whether a
    // recurrence counts as a regression. Clearing `regressedAt` on resolve is
    // deliberate too: the badge describes the CURRENT unresolved state, and a
    // resolved issue that still advertised a past regression would be confusing.
    await prisma.$executeRaw`
      UPDATE "Issue"
      SET "status" = ${nextStatus}::"IssueStatus",
          "statusChangedAt" = ${now}::timestamptz,
          "resolvedAt" = CASE WHEN ${nextStatus} = 'RESOLVED' THEN ${now}::timestamptz ELSE "resolvedAt" END,
          "regressedAt" = CASE WHEN ${nextStatus} = 'RESOLVED' THEN NULL ELSE "regressedAt" END,
          "ignoredUntil" = CASE
            WHEN ${nextStatus} = 'IGNORED' THEN ${body.ignored_until_millis == null ? null : new Date(body.ignored_until_millis)}::timestamptz
            ELSE NULL
          END,
          "updatedAt" = ${now}::timestamptz
      WHERE "tenancyId" = ${tenancy.id}::uuid AND "id" = ${resolved.item.id}::uuid
    `;

    // Fire-and-forget: a webhook delivery failure must not fail the user's
    // status change, which is already committed above.
    if (body.status === "resolved" || body.status === "ignored") {
      runAsynchronouslyAndWaitUntil(emitIssueLifecycleWebhook({
        tenancy,
        issueId: resolved.item.id,
        event: body.status,
        now,
      }));
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: resolved.item.id, status: body.status },
    } as const;
  },
});
