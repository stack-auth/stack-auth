import { checkManagedEmailProviderStatus } from "@/lib/managed-email-onboarding";
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
      domain_id: yupString().defined(),
      subdomain: yupString().defined(),
      sender_local_part: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["pending", "complete"]).defined(),
      missing_name_server_records: yupArray(yupString().defined()).optional(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const checkResult = await checkManagedEmailProviderStatus({
      tenancy: auth.tenancy,
      domainId: body.domain_id,
      subdomain: body.subdomain,
      senderLocalPart: body.sender_local_part,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        status: checkResult.status,
        ...(checkResult.status === "pending" ? { missing_name_server_records: checkResult.missingNameServerRecords } : {}),
      },
    };
  },
});
