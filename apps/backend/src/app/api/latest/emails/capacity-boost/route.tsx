import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const BOOST_DURATION_HOURS = 4;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Activate email capacity boost",
    description: "Temporarily increases email capacity by 4x for 4 hours.",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      expires_at: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const expiresAt = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);

    await globalPrismaClient.tenancy.update({
      where: { id: auth.tenancy.id },
      data: { emailCapacityBoostExpiresAt: expiresAt },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        expires_at: expiresAt.toISOString(),
      },
    };
  },
});
