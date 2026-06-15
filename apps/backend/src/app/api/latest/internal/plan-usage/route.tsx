import { getPlanUsageForProject } from "@/lib/plan-usage";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { planUsageResponseSchema } from "@hexclave/shared/dist/interface/plan-usage";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: planUsageResponseSchema,
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: await getPlanUsageForProject(req.auth.tenancy.project),
    };
  },
});
