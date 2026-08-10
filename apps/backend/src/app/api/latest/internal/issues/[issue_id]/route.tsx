import { Prisma } from "@/generated/prisma/client";
import { decodeOccurrenceCursor, deriveSubstatus, issueRangeStart, loadIssueWindowStats, loadOccurrence } from "@/lib/issues/issue-queries";
import { emitIssueLifecycleWebhook } from "@/lib/issues/issue-webhooks";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import {
  IssueDetailResponseSchema,
  IssueUpdateRequestSchema,
  type IssueFrame,
  type IssueListItem,
} from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import type { Tenancy } from "@/lib/tenancies";

type ResolvedIssue = {
  item: IssueListItem,
  hashes: string[],
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
    lastSeenRelease: string | null, updatedAt: Date,
    handled: boolean, synthetic: boolean, hashes: string[],
  }[]>(Prisma.sql`
    SELECT i."id", i."shortId", i."type", i."value", i."culprit", i."status"::text AS "status",
           i."firstSeenAt", i."lastSeenAt", i."regressedAt", i."timesSeen",
           i."countersTruncatedAt", i."ignoredUntil", i."serviceName",
           i."deploymentEnvironmentName", i."lastSeenRelease", i."updatedAt",
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

/**
 * `error_frames` is stored as a JSON string rather than a typed column, so it
 * has to be parsed defensively: a row written by an older grouping config, or a
 * degraded one, may hold `''`. Returning `[]` lets the UI fall back to
 * rendering the raw stack instead of blanking the panel.
 */
function parseFrames(raw: string): IssueFrame[] {
  if (raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((frame: Record<string, unknown>) => ({
      filename: typeof frame.filename === "string" ? frame.filename : null,
      function: typeof frame.function === "string" ? frame.function : null,
      module: typeof frame.module === "string" ? frame.module : null,
      abs_path: typeof frame.absPath === "string" ? frame.absPath : null,
      lineno: typeof frame.lineno === "number" ? frame.lineno : null,
      colno: typeof frame.colno === "number" ? frame.colno : null,
      in_app: frame.inApp === true,
      ...typeof frame.debugId === "string" ? { debug_id: frame.debugId } : {},
    }));
  } catch {
    return [];
  }
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
      throw new KnownErrors.AnalyticsNotEnabled();
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

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        issue: {
          ...resolved.item,
          window_occurrences: windowStats.occurrences,
          window_users: windowStats.users,
        },
        occurrence: occurrence === null ? null : {
          occurrence_id: occurrence.occurrence_id,
          event_at_millis: new Date(`${occurrence.event_at}Z`).getTime(),
          message: occurrence.message,
          level: occurrence.level,
          data: occurrence.data,
          frames: parseFrames(occurrence.error_frames),
          raw_stack: typeof occurrence.data.stack === "string" ? occurrence.data.stack : null,
          trace_id: occurrence.trace_id,
          span_id: occurrence.span_id,
          page_view_span_id: occurrence.page_view_span_id,
          session_replay_id: occurrence.session_replay_id,
          user_id: occurrence.user_id,
          service_name: occurrence.service_name,
          environment: occurrence.deployment_environment_name,
          release: resolved.item.release,
        },
        newer_cursor: newerCursor,
        older_cursor: olderCursor,
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
      throw new KnownErrors.AnalyticsNotEnabled();
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
