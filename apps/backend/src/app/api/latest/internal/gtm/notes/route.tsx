import { createGtmNote, GTM_DOMAINS, GTM_NOTE_CATEGORIES, GTM_NOTE_SOURCES, listGtmNotes, requireGtmReadProject, requireGtmWriteProject } from "@/lib/gtm/dashboard-content";
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
    return { statusCode: 200, bodyType: "json", body: await listGtmNotes(projectId, query.cursor) };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, body: yupObject({
    target_project_id: yupString().default("internal"),
    domain: yupString().oneOf(GTM_DOMAINS).defined(),
    category: yupString().oneOf(GTM_NOTE_CATEGORIES).defined(),
    title: yupString().trim().min(1).max(120).defined(),
    body: yupString().min(1).max(500).defined(),
    source: yupString().oneOf(GTM_NOTE_SOURCES).defined(),
  }).defined(), method: yupString().oneOf(["POST"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 201, bodyType: "json", body: await createGtmNote(projectId, body) };
  },
});
