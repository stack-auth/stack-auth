import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { parseGrowthBriefDate, upsertGrowthBrief } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      // Strict YYYY-MM-DD (UTC day); validated by parseGrowthBriefDate in the handler.
      date: yupString().defined(),
      summary: yupString().defined(),
      content_md: yupString().defined(),
      document: jsonSchema.optional(),
      data: jsonSchema.optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const result = await upsertGrowthBrief({
      tenancy,
      date: parseGrowthBriefDate(body.date),
      summary: body.summary,
      contentMd: body.content_md,
      document: body.document,
      data: body.data,
    });
    return { statusCode: 200, bodyType: "json", body: { brief_id: result.briefId } };
  },
});
