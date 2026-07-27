import { createGtmInsight, GTM_DOMAINS, gtmTimelineEntriesSchema, listGtmInsights, requireGtmReadProject, requireGtmWriteProject } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, query: yupObject({ cursor: yupString().optional(), project_id: yupString().optional() }).defined(), method: yupString().oneOf(["GET"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, query }) => {
    const projectId = await requireGtmReadProject({ authType: auth.type, authProjectId: auth.project.id, user: auth.user, targetProjectId: query.project_id });
    return { statusCode: 200, bodyType: "json", body: await listGtmInsights(projectId, query.cursor) };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    body: yupObject({
      target_project_id: yupString().default("internal"),
      domain: yupString().oneOf(GTM_DOMAINS).defined(),
      title: yupString().min(1).max(200).defined(),
      body: yupString().min(1).max(5000).defined(),
      impact_score: yupNumber().integer().min(0).max(100).defined(),
      times_seen: yupNumber().integer().min(1).optional(),
      timeline_entries: gtmTimelineEntriesSchema,
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 201, bodyType: "json", body: await createGtmInsight(projectId, body) };
  },
});
