import { consumeBrowserAction } from "@/lib/browser-actions";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { isBrowserActionConsumeResult } from "@hexclave/shared/dist/utils/browser-action-snippets";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    headers: yupObject({
      origin: yupTuple([yupString().optional()]).optional(),
    }).defined(),
    body: yupObject({
      action_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined().test("browser-action-result", "Invalid browser action result", isBrowserActionConsumeResult),
  }),
  handler: async ({ auth: { tenancy }, headers: { origin }, body: { action_id } }) => {
    const action = await consumeBrowserAction({
      tenancy,
      code: action_id,
      requestOrigin: origin?.[0],
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: action,
    };
  },
});
