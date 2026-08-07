import { listCatalogueForUi } from "@/lib/data-warehouse/api";
import { getCatalogueStats } from "@/lib/data-warehouse/catalogue";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      connectors: yupArray(yupMixed().defined()).defined(),
      // The gap between `total` and `exposed` is the mined-but-not-yet-offered
      // corpus (T2/T3 auth tiers, databases, object stores). Surfaced so the
      // catalogue page can say what is coming rather than implying the list is
      // all that was ever built.
      stats: yupMixed().defined(),
    }).defined(),
  }),
  async handler() {
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        connectors: listCatalogueForUi(),
        stats: getCatalogueStats(),
      },
    };
  },
});
