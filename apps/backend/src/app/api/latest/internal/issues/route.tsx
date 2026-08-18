import { PublicIssueListQuerySchema, parsePublicIssueListQuery } from "@/app/api/latest/issues/contract";
import { listIssues } from "@/lib/issues/issue-queries";
import { assertObservabilityEnabled } from "@/lib/issues/observability-gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { IssueListResponseSchema } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    // Deliberately the SAME query contract as the public list route: the
    // internal response adds dashboard-only fields, but the accepted filters,
    // allowlists, and error vocabulary must not fork. (This route used to
    // re-implement the parsers with a looser sort_dir and no cursor
    // validation.)
    query: PublicIssueListQuerySchema.optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueListResponseSchema,
  }),
  async handler({ auth, query }) {
    assertObservabilityEnabled(auth.tenancy);

    const result = await listIssues({
      tenancy: auth.tenancy,
      filters: parsePublicIssueListQuery(query),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: result,
    } as const;
  },
});
