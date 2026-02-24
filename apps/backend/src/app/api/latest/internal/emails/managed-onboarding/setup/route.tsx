import { setupManagedEmailProvider } from "@/lib/managed-email-onboarding";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

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
      subdomain: yupString().defined(),
      sender_local_part: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      domain_id: yupString().defined(),
      name_server_records: yupArray(yupString().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const setupResult = await setupManagedEmailProvider({
      subdomain: body.subdomain,
      senderLocalPart: body.sender_local_part,
      tenancyId: auth.tenancy.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        domain_id: setupResult.domainId,
        name_server_records: setupResult.nameServerRecords,
      },
    };
  },
});
