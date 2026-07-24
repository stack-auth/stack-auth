import { deleteGtmAction, GTM_ACTION_STATUSES, GTM_ACTION_TYPES, GTM_DOMAINS, GTM_VERDICTS, requireGtmWriteProject, updateGtmAction } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const base = {
  auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
  params: yupObject({ action_id: yupString().uuid().defined() }).defined(),
};

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({
    target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined(),
    domain: yupString().oneOf(GTM_DOMAINS).defined(),
    type: yupString().oneOf(GTM_ACTION_TYPES).defined(),
    status: yupString().oneOf(GTM_ACTION_STATUSES).defined(),
    title: yupString().min(1).max(200).defined(),
    summary: yupString().min(1).max(2000).defined(),
    verdict: yupString().oneOf(GTM_VERDICTS).nullable().defined(),
    retrospective_text: yupString().max(5000).nullable().defined(),
    expires_at_millis: yupNumber().defined(),
    executed_at_millis: yupNumber().nullable().defined(),
  }).defined(), method: yupString().oneOf(["PATCH"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    return { statusCode: 200, bodyType: "json", body: await updateGtmAction(projectId, params.action_id, body) };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ ...base, body: yupObject({ target_project_id: yupString().default("internal"), expected_updated_at_millis: yupNumber().defined() }).defined(), method: yupString().oneOf(["DELETE"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupObject({}).defined() }),
  handler: async ({ auth, params, body }) => {
    const projectId = await requireGtmWriteProject({ authProjectId: auth.project.id, user: auth.user, targetProjectId: body.target_project_id });
    await deleteGtmAction(projectId, params.action_id, body.expected_updated_at_millis);
    return { statusCode: 200, bodyType: "json", body: {} };
  },
});
