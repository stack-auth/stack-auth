import { resolveIssueIdentity } from "@/lib/issues/issue-identity";
import { unmergeIssue } from "@/lib/issues/issue-merge";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { IssueUnmergeRequestSchema, IssueUnmergeResponseSchema } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

/**
 * Split a strict subset of an issue's owned hashes out into a new issue.
 *
 * The split is RETROACTIVE: occurrences store their owning hash, not an issue
 * id, so historical occurrences of the moved hashes resolve to the new issue
 * immediately and without touching ClickHouse.
 *
 * `counters_truncated_at_millis` is not decoration. Lifetime counters cannot be
 * split (the occurrence stream only goes back as far as the telemetry TTL), so
 * the new issue's counters are seeded from the retained window and this field
 * tells the dashboard to render "N events since <date>" rather than an all-time
 * number nobody can back up.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    params: yupObject({
      // Not `.uuid()`: like the sibling detail and PATCH routes, this accepts
      // the numeric short id the UI displays, and follows merge redirects —
      // `resolveIssueIdentity` in the handler is the one grammar authority.
      issue_id: yupString().defined(),
    }).defined(),
    body: IssueUnmergeRequestSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueUnmergeResponseSchema,
  }),
  handler: async ({ auth, params, body }) => {
    // Same gate as the list and detail routes. A project that never installed
    // the observability app must not be able to mutate issue grouping through a
    // surface it does not have.
    if (auth.tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    // Resolving here (rather than `.uuid()` in the schema) also follows a
    // merge redirect: unmerging via a merged-away issue's retained id operates
    // on the survivor, which is the issue that actually owns the hashes now.
    const identity = await resolveIssueIdentity(auth.tenancy, params.issue_id);
    if (identity === null) throw new StatusError(StatusError.NotFound, "Issue not found");

    const { sourceIssueId, newIssueId, countersTruncatedAt } = await unmergeIssue({
      tenancy: auth.tenancy,
      issueId: identity.issueId,
      hashes: body.hashes,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        source_issue_id: sourceIssueId,
        new_issue_id: newIssueId,
        counters_truncated_at_millis: countersTruncatedAt.getTime(),
      },
    };
  },
});
