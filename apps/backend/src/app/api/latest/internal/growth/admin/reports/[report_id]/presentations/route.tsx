import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import {
  createGrowthReportPresentation,
  GROWTH_REPORT_PRESENTATION_FORMAT,
  GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES,
  listGrowthReportPresentations,
} from "@/lib/growth/report-presentation";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
    params: yupObject({ report_id: yupString().defined() }).defined(),
    query: yupObject({ project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, query }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await listGrowthReportPresentations(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id),
      params.report_id,
    ),
  }),
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    method: yupString().oneOf(["POST"]).defined(),
    params: yupObject({ report_id: yupString().defined() }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      format: yupString().oneOf([GROWTH_REPORT_PRESENTATION_FORMAT]).default(GROWTH_REPORT_PRESENTATION_FORMAT),
      tsx_source: yupString().max(GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES).defined(),
      action_item_ids: yupArray(yupString().defined()).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => ({
    statusCode: 201,
    bodyType: "json",
    body: await createGrowthReportPresentation({
      tenancy: await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      reportId: params.report_id,
      format: body.format,
      tsxSource: body.tsx_source,
      actionItemIds: body.action_item_ids,
      createdByUserId: auth.user?.id ?? null,
    }),
  }),
});
