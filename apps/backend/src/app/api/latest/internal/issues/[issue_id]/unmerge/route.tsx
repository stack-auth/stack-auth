import { unmergeIssue } from "@/lib/issues/issue-merge";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { IssueUnmergeRequestSchema, IssueUnmergeResponseSchema } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
      issue_id: yupString().uuid().defined(),
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

    const { sourceIssueId, newIssueId, countersTruncatedAt } = await unmergeIssue({
      tenancy: auth.tenancy,
      issueId: params.issue_id,
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
