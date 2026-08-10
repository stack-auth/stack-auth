import { mergeIssues } from "@/lib/issues/issue-merge";
import { emitIssueLifecycleWebhook } from "@/lib/issues/issue-webhooks";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { IssueMergeRequestSchema, IssueMergeResponseSchema } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Merge two or more issues into one.
 *
 * `internal/` because the whole observability surface is dashboard-only today; a
 * public API is a deliberate follow-up rather than an oversight.
 *
 * The caller does not choose the primary — see `orderIssuesForMerge`. Nothing in
 * this response is a `BigInt`, which matters because `smart-response.tsx` runs
 * the body through `JSON.stringify`, and that THROWS on a BigInt rather than
 * coercing it (it would be a 500 on the very first response). Any future field
 * carrying `shortId` or `timesSeen` must serialize as a decimal string.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: IssueMergeRequestSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueMergeResponseSchema,
  }),
  handler: async ({ auth, body }) => {
    // Same gate as the list and detail routes. A project that never installed
    // the observability app must not be able to mutate issue grouping through a
    // surface it does not have.
    if (auth.tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    const { primaryIssueId, mergedIssueIds } = await mergeIssues({
      tenancy: auth.tenancy,
      issueIds: body.issue_ids,
    });
    // Announced against the SURVIVING issue: the merged-away ids no longer
    // resolve to a row, so a consumer receiving one of those could not look it
    // up.
    runAsynchronouslyAndWaitUntil(emitIssueLifecycleWebhook({
      tenancy: auth.tenancy,
      issueId: primaryIssueId,
      event: "merged",
      now: new Date(),
    }));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        primary_issue_id: primaryIssueId,
        merged_issue_ids: mergedIssueIds,
      },
    };
  },
});
