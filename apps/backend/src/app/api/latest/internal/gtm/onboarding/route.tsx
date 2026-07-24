import { getGtmOnboardingStatus, requireGtmReadProject } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, method: yupString().oneOf(["GET"]).defined() }),
  response: responseSchema,
  handler: async ({ auth }) => {
    const projectId = await requireGtmReadProject({ authProjectId: auth.project.id, user: auth.user });
    return { statusCode: 200, bodyType: "json", body: await getGtmOnboardingStatus(projectId) };
  },
});
