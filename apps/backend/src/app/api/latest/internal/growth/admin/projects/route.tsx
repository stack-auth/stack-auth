import { listGrowthAdminProjects } from "@/lib/growth/admin";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(), method: yupString().oneOf(["GET"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth }) => ({ statusCode: 200, bodyType: "json", body: await listGrowthAdminProjects(auth.project.id, auth.user) }),
});
