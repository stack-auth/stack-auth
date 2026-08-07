import { createStreamView, dropStreamView } from "@/lib/data-warehouse/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Lazy, opt-in convenience views.
 *
 * Created only when a human asks for raw SQL against a stream, and dropped on
 * disconnect. They are never created automatically: a view per stream per
 * project would multiply into the table-count ceiling that the single
 * `imported_rows` table exists to avoid.
 */
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
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      view_name: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    return {
      statusCode: 200,
      bodyType: "json",
      body: await createStreamView(tenancy, params.source_id, body.stream),
    };
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
    query: yupObject({
      stream: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params, query }) {
    await dropStreamView(tenancy, params.source_id, query.stream);
    return { statusCode: 200, bodyType: "success" };
  },
});
