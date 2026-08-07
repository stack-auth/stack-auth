import { testAndDiscover } from "@/lib/data-sources/api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The setup wizard's hard gate.
 *
 * A failure is returned as a 200 with `ok: false` rather than as an error
 * status: the provider's own message is the payload the user needs to act on,
 * and routing it through the generic error path would flatten it into
 * "request failed". The wizard refuses to advance on `ok: false`.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      connector_id: yupString().defined(),
      settings: yupRecord(yupString().defined(), yupString().defined()).default({}),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      status: yupNumber().optional(),
      provider_message: yupString().optional(),
      streams: yupArray(yupMixed().defined()).optional(),
    }).defined(),
  }),
  async handler({ body }) {
    const result = await testAndDiscover({
      connectorId: body.connector_id,
      settings: body.settings,
    });
    if (!result.ok) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          ok: false,
          status: result.status,
          provider_message: result.providerMessage,
        },
      };
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: { ok: true, streams: result.streams },
    };
  },
});
