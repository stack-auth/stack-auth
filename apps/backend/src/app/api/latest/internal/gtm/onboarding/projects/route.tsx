import { listGtmOnboardedProjects } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  clientOrHigherAuthTypeSchema,
  projectDisplayNameSchema,
  projectIdSchema,
  yupArray,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({
  type: clientOrHigherAuthTypeSchema.defined(),
  project: adaptSchema.defined(),
  user: adaptSchema,
}).defined();

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        id: projectIdSchema.defined(),
        display_name: projectDisplayNameSchema.defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: await listGtmOnboardedProjects({
          authProjectId: auth.project.id,
          user: auth.user,
        }),
      },
    };
  },
});
