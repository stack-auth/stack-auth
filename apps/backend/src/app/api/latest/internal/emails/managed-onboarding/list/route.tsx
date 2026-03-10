import { listManagedEmailProviderDomains } from "@/lib/managed-email-onboarding";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        domain_id: yupString().defined(),
        subdomain: yupString().defined(),
        sender_local_part: yupString().defined(),
        status: yupString().oneOf(["pending_dns", "pending_verification", "verified", "applied", "failed"]).defined(),
        name_server_records: yupArray(yupString().defined()).defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const items = await listManagedEmailProviderDomains({
      tenancy: auth.tenancy,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: items.map((item) => ({
          domain_id: item.domainId,
          subdomain: item.subdomain,
          sender_local_part: item.senderLocalPart,
          status: item.status,
          name_server_records: item.nameServerRecords,
        })),
      },
    };
  },
});
