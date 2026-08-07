import { deleteSource, getSourceDetail, updateSource } from "@/lib/data-warehouse/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      source_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    return {
      statusCode: 200,
      bodyType: "json",
      body: await getSourceDetail(tenancy, params.source_id),
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      source_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      display_name: yupString().optional(),
      paused: yupBoolean().optional(),
      schedule: yupObject({
        kind: yupString().defined(),
        value: yupString().nullable().optional(),
      }).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    await updateSource({
      tenancy,
      sourceId: params.source_id,
      displayName: body.display_name,
      paused: body.paused,
      schedule: body.schedule,
    });
    return { statusCode: 200, bodyType: "success" };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      source_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    await deleteSource(tenancy, params.source_id);
    return { statusCode: 200, bodyType: "success" };
  },
});
