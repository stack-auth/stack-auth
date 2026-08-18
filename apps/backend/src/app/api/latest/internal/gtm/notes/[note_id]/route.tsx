import { deleteGtmNote, GTM_DOMAINS, GTM_NOTE_CATEGORIES, GTM_NOTE_SOURCES, requireGtmWriteProject, updateGtmNote } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const base = {
  auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
  params: yupObject({ note_id: yupString().uuid().defined() }).defined(),
};

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({
    target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined(),
    domain: yupString().oneOf(GTM_DOMAINS).defined(),
    category: yupString().oneOf(GTM_NOTE_CATEGORIES).defined(),
    title: yupString().trim().min(1).max(120).defined(),
    body: yupString().min(1).max(500).defined(),
    source: yupString().oneOf(GTM_NOTE_SOURCES).defined(),
  }).defined(), method: yupString().oneOf(["PATCH"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 200, bodyType: "json", body: await updateGtmNote(projectId, params.note_id, body) };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({ target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined() }).defined(), method: yupString().oneOf(["DELETE"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupObject({}).defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    await deleteGtmNote(projectId, params.note_id, body.expected_updated_at_millis);
    return { statusCode: 200, bodyType: "json", body: {} };
  },
});
