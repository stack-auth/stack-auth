import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import { getIssueAlertRule } from "@/lib/issues/issue-alerts/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { issueAlertAuthSchema, issueAlertRuleParamsSchema } from "../_shared";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get an issue alert rule",
    description: "Returns one tenant-, project-, and branch-scoped issue alert rule version.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: issueAlertAuthSchema,
    params: issueAlertRuleParamsSchema,
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ rule: yupMixed().defined() }).defined(),
  }),
  async handler({ auth, params }) {
    assertPublicIssueReadEnabled(auth.tenancy);
    const rule = await getIssueAlertRule(auth.tenancy, params.rule_id);
    if (rule === null) throw new StatusError(StatusError.NotFound, "Issue alert rule not found");
    return { statusCode: 200, bodyType: "json", body: { rule } } as const;
  },
});
