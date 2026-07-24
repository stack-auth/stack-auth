import { createGtmAction, GTM_ACTION_STATUSES, GTM_ACTION_TYPES, GTM_DOMAINS, GTM_VERDICTS, listGtmActions, requireGtmReadProject, requireGtmWriteProject } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const actionBody = {
  domain: yupString().oneOf(GTM_DOMAINS).defined(),
  type: yupString().oneOf(GTM_ACTION_TYPES).defined(),
  status: yupString().oneOf(GTM_ACTION_STATUSES).defined(),
  title: yupString().min(1).max(200).defined(),
  summary: yupString().min(1).max(2000).defined(),
  verdict: yupString().oneOf(GTM_VERDICTS).nullable().optional(),
  retrospective_text: yupString().max(5000).nullable().optional(),
  expires_at_millis: yupNumber().defined(),
  executed_at_millis: yupNumber().nullable().optional(),
};
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, query: yupObject({ cursor: yupString().optional(), project_id: yupString().optional() }).defined(), method: yupString().oneOf(["GET"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, query }) => {
    const projectId = await requireGtmReadProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: query.project_id });
    return { statusCode: 200, bodyType: "json", body: await listGtmActions(projectId, query.cursor) };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, body: yupObject({ target_project_id: yupString().default("internal"), ...actionBody }).defined(), method: yupString().oneOf(["POST"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 201, bodyType: "json", body: await createGtmAction(projectId, body) };
  },
});
