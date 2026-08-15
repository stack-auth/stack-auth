import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import { disableIssueAlertRule } from "@/lib/issues/issue-alerts/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { issueAlertAuthSchema, issueAlertRuleParamsSchema } from "../../_shared";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Disable an issue alert rule",
    description: "Disables every stored version of a tenant-, project-, and branch-scoped issue alert rule without deleting delivery history.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: issueAlertAuthSchema,
    params: issueAlertRuleParamsSchema,
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ rule: yupMixed().defined(), changed: yupBoolean().defined() }).defined(),
  }),
  async handler({ auth, params }) {
    assertPublicIssueReadEnabled(auth.tenancy);
    const result = await disableIssueAlertRule(auth.tenancy, params.rule_id);
    if (result === null) throw new StatusError(StatusError.NotFound, "Issue alert rule not found");
    return { statusCode: 200, bodyType: "json", body: result } as const;
  },
});
