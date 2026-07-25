import { deleteGtmInsight, GTM_DOMAINS, gtmTimelineEntriesSchema, requireGtmWriteProject, updateGtmInsight } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const base = {
  auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
  params: yupObject({ insight_id: yupString().uuid().defined() }).defined(),
};

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({
    target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined(),
    domain: yupString().oneOf(GTM_DOMAINS).defined(),
    title: yupString().min(1).max(200).defined(),
    body: yupString().min(1).max(5000).defined(),
    impact_score: yupNumber().integer().min(0).max(100).defined(),
    times_seen: yupNumber().integer().min(1).defined(),
    timeline_entries: gtmTimelineEntriesSchema,
  }).defined(), method: yupString().oneOf(["PATCH"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 200, bodyType: "json", body: await updateGtmInsight(projectId, params.insight_id, body) };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({ target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined() }).defined(), method: yupString().oneOf(["DELETE"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupObject({}).defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    await deleteGtmInsight(projectId, params.insight_id, body.expected_updated_at_millis);
    return { statusCode: 200, bodyType: "json", body: {} };
  },
});
