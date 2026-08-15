import { listIssueActivity } from "@/lib/issues/issue-product";
import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const AuthSchema = yupObject({ type: serverOrHigherAuthTypeSchema.defined(), tenancy: adaptSchema.defined() }).defined();
const ParamsSchema = yupObject({ issue_id: yupString().defined() }).defined();
const ResponseSchema = yupObject({ items: yupArray(yupMixed().defined()).defined() }).defined();

export const GET = createSmartRouteHandler({
  metadata: { summary: "List issue activity", description: "Returns a bounded, branch-scoped issue activity stream.", tags: ["Issues"] },
  request: yupObject({ auth: AuthSchema, params: ParamsSchema }).defined(),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: ResponseSchema }).defined(),
  async handler({ auth, params }) {
    assertPublicIssueReadEnabled(auth.tenancy);
    try {
      const items = await listIssueActivity({ tenancy: auth.tenancy, issueId: params.issue_id });
      return { statusCode: 200, bodyType: "json", body: { items: [...items] } } as const;
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) throw new StatusError(StatusError.NotFound, "Issue not found");
      throw error;
    }
  },
});
