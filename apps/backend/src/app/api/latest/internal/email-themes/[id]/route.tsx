import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { internalEmailThemesCudHandlers } from "../cud";

export const GET = internalEmailThemesCudHandlers.readHandler;

export const PATCH = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      id: yupString().defined(),
    }).defined(),
    body: yupObject({
      tsx_source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      display_name: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id }, body }) {
    const result = await internalEmailThemesCudHandlers.adminUpdate({
      tenancy,
      allowedErrorTypes: [StatusError],
      id,
      data: [{
        tsx_source: body.tsx_source,
      }],
    });

    const updated = result.items.find((t) => t.id === id);
    if (!updated) {
      throw new StackAssertionError("Theme was updated but could not be found afterwards", { id });
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        display_name: updated.display_name,
      },
    };
  },
});
