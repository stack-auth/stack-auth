import { updateStreams } from "@/lib/data-warehouse/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
      streams: yupArray(yupObject({
        name: yupString().defined(),
        enabled: yupBoolean().optional(),
        sync_mode: yupString().optional(),
        cursor_field: yupString().nullable().optional(),
        primary_key: yupArray(yupString().defined()).nullable().optional(),
      }).defined()).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    await updateStreams({ tenancy, sourceId: params.source_id, streams: body.streams });
    return { statusCode: 200, bodyType: "success" };
  },
});
