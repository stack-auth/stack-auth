import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupMixed(),
      user: yupMixed(),
      tenancy: yupMixed(),
    }).nullable(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupMixed(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
  }),
  handler: async (req) => {
    captureError("check-feature-support", new StackAssertionError(`${req.auth?.user?.primaryEmail || "User"} tried to check support of unsupported feature: ${JSON.stringify(req.body, null, 2)}`, { req }));
    return {
      statusCode: 200,
      bodyType: "text",
      body: deindent`
        ${req.body?.feature_name ?? "This feature"} is not yet supported. Please reach out to Stack support for more information.
      `,
    };
  },
});
