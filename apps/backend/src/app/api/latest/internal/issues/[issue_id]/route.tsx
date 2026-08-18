import { createProductionErrorAttachmentService } from "@/lib/attachments";
import { getErrorAttachmentEventId } from "@/lib/attachments/attachment-event-id";
import { validateErrorAttachmentScope } from "@/lib/attachments/attachment-contract";
import { loadIssueDetailContext, projectIssueListItem } from "@/lib/issues/issue-detail";
import { transitionIssueStatus } from "@/lib/issues/issue-lifecycle";
import { withIssueActionTarget } from "@/app/api/latest/issues/[issue_id]/actions/_shared";
import { decodeOccurrenceCursor, issueRangeStart, loadIssueWindowStats, loadOccurrence } from "@/lib/issues/issue-queries";
import { loadIssueProductSnapshot } from "@/lib/issues/issue-product";
import { serializeIssueProductSnapshot } from "@/lib/issues/issue-product-projection";
import { assertObservabilityEnabled } from "@/lib/issues/observability-gate";
import { projectPublicIssueOccurrence } from "@/lib/issues/occurrence-projection";
import { loadIssueReleaseContext } from "@/lib/releases/issue-release-context";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { scrubErrorIngestPayload } from "@/lib/error-ingest";
import { parsePublicIssueHours } from "@/app/api/latest/issues/contract";
import {
  IssueDetailResponseSchema,
  IssueUpdateRequestSchema,
  type IssueAttachment,
} from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

/**
 * The dashboard's own error-envelope parse, kept separate from the public
 * `parsePublicErrorEnvelope` on purpose: the internal view has no size cap and
 * no JSON-serializability narrowing (the dashboard renders whatever was
 * stored), and it treats a stored "{}" as absent.
 */
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
      // Same allowlisted vocabulary as the list route (and the dashboard's
      // time-range toggle); parsed through the shared contract so an invalid
      // value 400s instead of silently falling back to 24h.
      hours: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueDetailResponseSchema,
  }),
  async handler({ auth, params, query }) {
    const tenancy = auth.tenancy;
    assertObservabilityEnabled(tenancy);

    const now = new Date();
    // The window is caller-selected so the detail header's counts can match
    // whatever time range the issue list is showing, rather than always 24h.
    const rangeStart = issueRangeStart(parsePublicIssueHours(query.hours), now);
    const resolved = await loadIssueDetailContext(tenancy, params.issue_id);
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
    const issue = projectIssueListItem(resolved.row, { rangeStart, now, stats: windowStats });
    const product = await loadIssueProductSnapshot({ tenancy, issueId: issue.id });
    const releaseContext = await loadIssueReleaseContext({
      tenancy,
      issueId: issue.id,
      firstSeenRelease: resolved.row.firstSeenRelease,
      lastSeenRelease: resolved.row.lastSeenRelease,
    });
    const errorEnvelope = occurrence === null ? null : parseErrorEnvelope(occurrence.error_envelope);
    const attachmentEventId = occurrence === null ? null : getErrorAttachmentEventId(occurrence.occurrence_id);
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
        issue,
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
    assertObservabilityEnabled(tenancy);

    const now = new Date();

    // Delegates to the ONE lifecycle implementation (the same one behind the
    // public issue action routes) rather than a hand-rolled UPDATE. This is
    // what makes the mutation idempotent: a retried PATCH with an identical
    // body derives `status_unchanged`, so it neither re-stamps
    // `statusChangedAt`/`resolvedAt` (which the substatus and regression logic
    // read) nor emits a duplicate lifecycle webhook. `resolvedAt` is still set
    // on every genuine transition INTO resolved — the ingest path compares a
    // later occurrence against it to decide whether a recurrence counts as a
    // regression — and `regressedAt` is cleared on resolve because the badge
    // describes the CURRENT unresolved state.
    const { target } = await withIssueActionTarget({
      tenancy,
      rawIssueId: params.issue_id,
      action: (resolved) => transitionIssueStatus({
        tenancy,
        issueId: resolved.issueId,
        mutation: {
          status: body.status,
          ignoredUntil: body.status === "ignored" && body.ignored_until_millis != null ? new Date(body.ignored_until_millis) : null,
        },
        changedAt: now,
      }),
    });

    // The `issue.resolved` / `issue.ignored` webhook is emitted by
    // `transitionIssueStatus` itself (fire-and-forget, only on a genuine
    // transition), so every route that performs this lifecycle action — this
    // one and the public status/snooze/bulk actions — behaves identically.

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: target.issueId, status: body.status },
    } as const;
  },
});
