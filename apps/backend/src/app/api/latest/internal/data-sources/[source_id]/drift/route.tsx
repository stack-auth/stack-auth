import { resolveDrift } from "@/lib/data-sources/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
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
      stream: yupString().defined(),
      action: yupString().oneOf(["approve", "ignore"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    await resolveDrift({
      tenancy,
      sourceId: params.source_id,
      streamName: body.stream,
      action: body.action,
    });
    return { statusCode: 200, bodyType: "success" };
  },
});
