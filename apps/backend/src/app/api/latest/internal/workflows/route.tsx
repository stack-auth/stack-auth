import { listWorkflowsWithStats, syncWorkflowSource } from "@/lib/workflows/api";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      workflows: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        workflows: await listWorkflowsWithStats(tenancy),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      id: yupString().defined(),
      display_name: yupString().optional(),
      source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  async handler({ auth: { tenancy }, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    const result = await syncWorkflowSource(tenancy, {
      workflowId: body.id,
      source: body.source,
      displayName: body.display_name,
      mustBeNew: true,
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: result,
    };
  },
});
