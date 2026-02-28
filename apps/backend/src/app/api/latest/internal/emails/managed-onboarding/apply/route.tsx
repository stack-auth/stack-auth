import { applyManagedEmailProvider } from "@/lib/managed-email-onboarding";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      domain_id: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["applied"]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const result = await applyManagedEmailProvider({
      tenancy: auth.tenancy,
      domainId: body.domain_id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        status: result.status,
      },
    };
  },
});
