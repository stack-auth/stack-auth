import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { deleteGrowthMilestoneBody, updateGrowthMilestoneBody } from "@/lib/growth/milestones";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({
      milestone_id: yupString().uuid().defined(),
    }).defined(),
    body: yupObject({
      // The allowed values (armed <-> disabled only; "reached" is engine-owned) are enforced in the
      // lib function so the transition table lives in one place.
      status: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const item = await updateGrowthMilestoneBody(auth.tenancy, params.milestone_id, { status: body.status });
    return { statusCode: 200, bodyType: "json", body: item };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["DELETE"]).defined(),
    params: yupObject({
      milestone_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const body = await deleteGrowthMilestoneBody(auth.tenancy, params.milestone_id);
    return { statusCode: 200, bodyType: "json", body };
  },
});
