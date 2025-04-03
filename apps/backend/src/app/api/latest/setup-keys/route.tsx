import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { setupCodeVerificationCodeHandler } from "./setup-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    body: yupObject({}).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      code: yupString().defined(),
      expires_at_millis: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth }) {
    const code = await setupCodeVerificationCodeHandler.createCode({
      tenancy: auth.tenancy,
      data: {},
      method: {},
      callbackUrl: undefined,
      expiresInMs: 1000 * 60 * 20, // 20 minutes
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        code: code.code,
        expires_at_millis: code.expiresAt.getTime(),
      },
    };
  },
});
