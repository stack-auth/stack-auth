import { createSource, listSources } from "@/lib/data-warehouse/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";

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
      sources: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    return {
      statusCode: 200,
      bodyType: "json",
      body: { sources: await listSources(tenancy) },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      connector_id: yupString().defined(),
      display_name: yupString().default(""),
      // Secrets ride in the same bundle as plain config and are split apart by
      // the connector manifest's own `secret` flags before anything is stored.
      settings: yupRecord(yupString().defined(), yupString().defined()).default({}),
      streams: yupArray(yupObject({
        name: yupString().defined(),
        sync_mode: yupString().optional(),
        cursor_field: yupString().nullable().optional(),
        primary_key: yupArray(yupString().defined()).nullable().optional(),
      }).defined()).defined(),
      schedule: yupObject({
        kind: yupString().defined(),
        value: yupString().nullable().optional(),
      }).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body }) {
    const created = await createSource({
      tenancy,
      connectorId: body.connector_id,
      displayName: body.display_name,
      settings: body.settings,
      selectedStreams: body.streams,
      schedule: body.schedule,
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: { id: created.id },
    };
  },
});
