import { loadIssueProductSnapshot } from "@/lib/issues/issue-product";
import { serializeIssueProductSnapshot } from "@/lib/issues/issue-product-projection";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { IssueProductMetadataSchema } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";

const AuthSchema = yupObject({ type: serverOrHigherAuthTypeSchema.defined(), tenancy: adaptSchema.defined() }).defined();
const ParamsSchema = yupObject({ issue_id: yupString().defined() }).defined();
const ResponseSchema = IssueProductMetadataSchema;

export const GET = createSmartRouteHandler({
  metadata: { summary: "Get issue product metadata", description: "Returns bounded priority, ownership, activity, comment, subscription, and bookmark state for an issue.", tags: ["Issues"] },
  request: yupObject({ auth: AuthSchema, params: ParamsSchema }).defined(),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: ResponseSchema }).defined(),
  async handler({ auth, params }) {
    assertPublicIssueReadEnabled(auth.tenancy);
    try {
      const snapshot = await loadIssueProductSnapshot({ tenancy: auth.tenancy, issueId: params.issue_id });
      return {
        statusCode: 200,
        bodyType: "json",
        body: serializeIssueProductSnapshot(snapshot),
      } as const;
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) throw new StatusError(StatusError.NotFound, "Issue not found");
      throw error;
    }
  },
});
