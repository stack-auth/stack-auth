import { listSyncRuns } from "@/lib/data-sources/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
    body: yupObject({
      runs: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    return {
      statusCode: 200,
      bodyType: "json",
      body: { runs: await listSyncRuns(tenancy, params.source_id) },
    };
  },
});
